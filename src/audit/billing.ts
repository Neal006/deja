import { createHash } from "node:crypto";
import type { Message } from "../anthropic/types.js";
import { CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER } from "../core/pricing.js";

/**
 * A model of Anthropic-style prompt caching, used to bill replayed sessions.
 *
 * The cache matches on an exact prefix. For each request we find how many
 * leading messages are byte-identical to the previous request: those are
 * cache reads (0.1x). Everything from the first difference on is a cache
 * write (1.25x). If the previous request is older than the TTL, nothing is
 * cached. The system prompt and tool definitions are modelled as a constant
 * block in front of the messages.
 *
 * Costs are in "base input token" units: multiply by the model's input
 * price per token to get dollars.
 */

export interface BillingConfig {
  /** Tokens of system prompt + tool definitions in front of every request. */
  systemTokens: number;
  ttlMs: number;
  writeMultiplier: number;
  readMultiplier: number;
}

export const DEFAULT_BILLING: BillingConfig = {
  systemTokens: 20_000,
  ttlMs: 300_000,
  writeMultiplier: CACHE_WRITE_MULTIPLIER,
  readMultiplier: CACHE_READ_MULTIPLIER,
};

export function messageHash(m: Message): string {
  return createHash("sha1").update(JSON.stringify(m)).digest("base64");
}

export interface Bill {
  cost: number;
  cachedTokens: number;
  writtenTokens: number;
  promptTokens: number;
  requests: number;
}

export class CacheBiller {
  private prevHashes: string[] = [];
  private lastTime: number | undefined;
  readonly bill: Bill = { cost: 0, cachedTokens: 0, writtenTokens: 0, promptTokens: 0, requests: 0 };

  constructor(private readonly cfg: BillingConfig = DEFAULT_BILLING) {}

  /**
   * Bill one request.
   * @param hashes one hash per message in the prompt
   * @param tokens estimated tokens per message, aligned with `hashes`
   * @param time request time (epoch ms), if known
   */
  charge(hashes: string[], tokens: number[], time?: number): number {
    const expired =
      this.bill.requests === 0 ||
      (time !== undefined && this.lastTime !== undefined && time - this.lastTime > this.cfg.ttlMs);
    if (time !== undefined) this.lastTime = time;

    let common = 0;
    if (!expired) {
      while (common < hashes.length && common < this.prevHashes.length && hashes[common] === this.prevHashes[common]) common++;
    }
    let cached = expired ? 0 : this.cfg.systemTokens;
    let written = expired ? this.cfg.systemTokens : 0;
    for (let i = 0; i < tokens.length; i++) {
      if (i < common) cached += tokens[i]!;
      else written += tokens[i]!;
    }
    const cost = cached * this.cfg.readMultiplier + written * this.cfg.writeMultiplier;
    this.bill.cost += cost;
    this.bill.cachedTokens += cached;
    this.bill.writtenTokens += written;
    this.bill.promptTokens += cached + written;
    this.bill.requests++;
    this.prevHashes = hashes;
    return cost;
  }
}
