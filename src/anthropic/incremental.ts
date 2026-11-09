import type { Message, MessagesRequest } from "./types.js";
import { TransformEngine, type TransformOptions, type TransformResult } from "./transform.js";

/**
 * Incremental rewriting for a growing conversation.
 *
 * Agents resend the whole conversation on every request, only ever adding
 * messages at the end. Because rewrites are prefix-deterministic, an engine
 * that has already processed messages 0..n-1 can simply continue with the
 * new ones, making a session O(n) instead of O(n²).
 *
 * The cached engine is reused only when it is provably equivalent to a
 * fresh run: same system prompt, same options (including the eviction set),
 * and an identical message prefix. Anything else (a client that rewrote
 * history, a new eviction) falls back to a full rebuild.
 */
export class IncrementalTransformer {
  private engine: TransformEngine | undefined;
  private signature = "";
  /** Serialized input messages the engine has processed. */
  private seen: string[] = [];
  /** The exact message objects last seen, for a cheap identity check. */
  private seenRefs: Message[] = [];
  /** How many requests were served incrementally vs rebuilt (for tests/metrics). */
  readonly counters = { incremental: 0, rebuilt: 0 };

  transform(body: MessagesRequest, options: TransformOptions = {}): TransformResult {
    const sig = signature(body, options);
    const msgs = body.messages;
    if (!this.engine || sig !== this.signature || !this.extends(msgs)) {
      this.engine = new TransformEngine(body.system, options);
      this.signature = sig;
      this.seen = [];
      this.seenRefs = [];
      this.counters.rebuilt++;
    } else {
      this.counters.incremental++;
    }
    for (let i = this.seen.length; i < msgs.length; i++) {
      const m = msgs[i]!;
      this.engine.push(m);
      this.seen.push(JSON.stringify(m));
      this.seenRefs.push(m);
    }
    return this.engine.result(body);
  }

  /** Whether `msgs` starts with exactly the messages already processed. */
  private extends(msgs: Message[]): boolean {
    if (msgs.length < this.seen.length) return false;
    for (let i = 0; i < this.seen.length; i++) {
      if (msgs[i] === this.seenRefs[i]) continue;
      if (JSON.stringify(msgs[i]) !== this.seen[i]) return false;
      this.seenRefs[i] = msgs[i]!;
    }
    return true;
  }
}

function signature(body: MessagesRequest, options: TransformOptions): string {
  return JSON.stringify([
    body.system ?? null,
    options.compress ?? null,
    [...(options.skipTools ?? [])].sort(),
    [...(options.evict ?? [])].sort(),
  ]);
}

/**
 * A small LRU of incremental transformers, keyed by conversation.
 * Used by the proxy, which serves many conversations at once.
 */
export class IncrementalCache {
  private readonly entries = new Map<string, IncrementalTransformer>();

  constructor(private readonly capacity = 32) {}

  get(key: string): IncrementalTransformer {
    let t = this.entries.get(key);
    if (t) {
      this.entries.delete(key);
    } else {
      t = new IncrementalTransformer();
      if (this.entries.size >= this.capacity) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
    }
    this.entries.set(key, t);
    return t;
  }

  get size(): number {
    return this.entries.size;
  }
}
