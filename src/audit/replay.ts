import { transformRequest } from "../anthropic/transform.js";
import type { Message, MessagesRequest } from "../anthropic/types.js";
import { takeInventory } from "../decay/inventory.js";
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
  // Baseline hashes never change once computed, so memoise them.
  const baseHashes: string[] = [];

  for (let j = 1; j < seg.messages.length; j++) {
    if (seg.messages[j]!.role !== "assistant") continue;
    const prompt = seg.messages.slice(0, j);
    const time = seg.times[j - 1] ?? seg.times[j];
    let sent: Message[];

    if (strategy === "baseline") {
      sent = prompt;
      while (baseHashes.length < prompt.length) baseHashes.push(messageHash(prompt[baseHashes.length]!));
      biller.charge(baseHashes.slice(0, prompt.length), takeInventory(request(sent, opts.cwd)).messageTokens, time);
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
    sent = transformRequest(body, opt).body.messages;
    biller.charge(sent.map(messageHash), takeInventory(request(sent, opts.cwd)).messageTokens, time);
  }
  return biller.bill;
}

/** Compression settings that never match, so "eager" measures pruning alone. */
const NO_COMPRESS = {
  minLines: Number.MAX_SAFE_INTEGER,
  minChars: Number.MAX_SAFE_INTEGER,
  minInputLines: Number.MAX_SAFE_INTEGER,
  minSavedTokens: Number.MAX_SAFE_INTEGER,
  minSavedRatio: 1,
};

export type StrategyBills = Record<Strategy, Bill>;

export function emptyBill(): Bill {
  return { cost: 0, cachedTokens: 0, writtenTokens: 0, promptTokens: 0, requests: 0 };
}

export function addBill(a: Bill, b: Bill): Bill {
  return {
    cost: a.cost + b.cost,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    writtenTokens: a.writtenTokens + b.writtenTokens,
    promptTokens: a.promptTokens + b.promptTokens,
    requests: a.requests + b.requests,
  };
}

export function replayAll(seg: Segment, opts: ReplayOptions = {}, strategies: readonly Strategy[] = STRATEGIES): Partial<StrategyBills> {
  const out: Partial<StrategyBills> = {};
  for (const s of strategies) out[s] = replaySegment(seg, s, opts);
  return out;
}
