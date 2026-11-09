import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { freshState, type ConversationState } from "./policy.js";

/**
 * Per-conversation decay state, optionally persisted to disk so that a
 * restarted proxy keeps stubbing exactly what it stubbed before (anything
 * else would change the prompt prefix and throw away the cache).
 */
export class StateStore {
  private readonly states = new Map<string, ConversationState>();

  constructor(
    private readonly path?: string,
    private readonly maxConversations = 500,
  ) {
    if (path && existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, ConversationState>;
        for (const [k, v] of Object.entries(raw)) {
          if (v && Array.isArray(v.evicted) && typeof v.rent === "number") this.states.set(k, v);
        }
      } catch {
        // A corrupt state file only costs one cache rebuild; start fresh.
      }
    }
  }

  get(key: string): ConversationState {
    let s = this.states.get(key);
    if (!s) {
      s = freshState();
      this.states.set(key, s);
    }
    return s;
  }

  peek(key: string): ConversationState | undefined {
    return this.states.get(key);
  }

  get size(): number {
    return this.states.size;
  }

  /** Drop the least recently seen conversations beyond the cap. */
  prune(): void {
    if (this.states.size <= this.maxConversations) return;
    const sorted = [...this.states.entries()].sort((a, b) => (a[1].lastSeen ?? 0) - (b[1].lastSeen ?? 0));
    for (const [k] of sorted.slice(0, this.states.size - this.maxConversations)) this.states.delete(k);
  }

  save(): void {
    if (!this.path) return;
    this.prune();
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.states)));
    renameSync(tmp, this.path);
  }
}
