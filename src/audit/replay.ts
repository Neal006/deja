import { IncrementalTransformer } from "../anthropic/incremental.js";
import type { Message, MessagesRequest } from "../anthropic/types.js";
import { messageTokens, takeInventory } from "../decay/inventory.js";
import { decide, DEFAULT_DECAY, freshState, type DecayConfig } from "../decay/policy.js";
import { CacheBiller, DEFAULT_BILLING, messageHash, type Bill, type BillingConfig } from "./billing.js";
import type { Segment } from "./transcript.js";

/**
 * Replay a recorded session request by request under different context
 * strategies and bill each one with the prompt-cache model.
 *
 *  - baseline: what the agent actually sent
 *  - eager:    prune every stale tool output as soon as it is old enough
 *              (what context pruners typically do)
 *  - dedup:    deja back-references only (append-only, cache-neutral)
 *  - deja:     back-references plus ski-rental decay
 */
export const STRATEGIES = ["baseline", "eager", "dedup", "deja"] as const;
export type Strategy = (typeof STRATEGIES)[number];

export interface ReplayOptions {
  billing?: BillingConfig;
  decay?: DecayConfig;
  cwd?: string;
}

function request(messages: Message[], cwd: string | undefined): MessagesRequest {
  return { system: cwd ? `Working directory: ${cwd}` : undefined, messages };
}

export function replaySegment(seg: Segment, strategy: Strategy, opts: ReplayOptions = {}): Bill {
  const biller = new CacheBiller(opts.billing ?? DEFAULT_BILLING);
  const decay = opts.decay ?? DEFAULT_DECAY;
  const state = freshState();
  const engine = new IncrementalTransformer();
  // Transforms are prefix-deterministic: while the eviction set is unchanged,
  // every message already sent is re-sent byte for byte. So hashes and token
  // counts computed for earlier requests stay valid and only new messages
  // need work. A change in the eviction set invalidates everything.
  let hashes: string[] = [];
  let tokens: number[] = [];
  let evictKey = "";

  for (let j = 1; j < seg.messages.length; j++) {
    if (seg.messages[j]!.role !== "assistant") continue;
    const prompt = seg.messages.slice(0, j);
    const time = seg.times[j - 1] ?? seg.times[j];
    let sent: Message[];

    if (strategy === "baseline") {
      extend(prompt);
      biller.charge(hashes.slice(0, prompt.length), tokens.slice(0, prompt.length), time);
      continue;
    }

    const body = request(prompt, opts.cwd);
    let evict: Set<string> | undefined;
    if (strategy === "eager") {
      evict = new Set(
        takeInventory(body)
          .items.filter((it) => it.age >= decay.minAge && it.saving >= decay.minSaving)
          .map((it) => it.id),
      );
    } else if (strategy === "deja") {
      evict = decide(body, state, time ?? 0, decay).evict;
    }
    const opt = strategy === "eager" ? { evict, compress: NO_COMPRESS } : { evict };
    sent = engine.transform(body, opt).body.messages;
    const key = evict ? [...evict].sort().join(",") : "";
    if (key !== evictKey) {
      evictKey = key;
      hashes = [];
      tokens = [];
    }
    extend(sent);
    biller.charge(hashes.slice(0, sent.length), tokens.slice(0, sent.length), time);
  }
  return biller.bill;

  function extend(sent: Message[]): void {
    for (let i = hashes.length; i < sent.length; i++) {
      hashes.push(messageHash(sent[i]!));
      tokens.push(messageTokens(sent[i]!));
    }
  }
}

/** Compression settings that never match, so "eager" measures pruning alone. */
const NO_COMPRESS = {
  minLines: Number.MAX_SAFE_INTEGER,
  minChars: Number.MAX_SAFE_INTEGER,
  minInputLines: Number.MAX_SAFE_INTEGER,
  minSavedTokens: Number.MAX_SAFE_INTEGER,
  minSavedRatio: 1,
  maxInputChars: 0,
};

export type StrategyBills = Record<Strategy, Bill>;

export function emptyBill(): Bill {
  return { cost: 0, cachedTokens: 0, writtenTokens: 0, promptTokens: 0, requests: 0, lastPrompt: 0 };
}

export function addBill(a: Bill, b: Bill): Bill {
  return {
    cost: a.cost + b.cost,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    writtenTokens: a.writtenTokens + b.writtenTokens,
    promptTokens: a.promptTokens + b.promptTokens,
    requests: a.requests + b.requests,
    lastPrompt: b.lastPrompt,
  };
}

export function replayAll(seg: Segment, opts: ReplayOptions = {}, strategies: readonly Strategy[] = STRATEGIES): Partial<StrategyBills> {
  const out: Partial<StrategyBills> = {};
  for (const s of strategies) out[s] = replaySegment(seg, s, opts);
  return out;
}
