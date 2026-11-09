import type { MessagesRequest } from "../anthropic/types.js";
import { CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER } from "../core/pricing.js";
import { cacheTtlMs, takeInventory, type Item } from "./inventory.js";

/**
 * Cache-aware decay: when should stale context be evicted?
 *
 * Keeping D stale tokens in a cached prompt costs "rent" of D x 0.1 on every
 * request. Evicting them changes the prompt at position p, so everything
 * after p must be written to the cache again. If S is the cached suffix
 * from p, that request costs 1.25 x (S - D) instead of 0.1 x S: a one-off
 * "purchase" of 1.25 x (S - D) - 0.1 x S (free when D dominates S).
 *
 * This is the ski-rental problem. Paying rent until the rent paid equals the
 * purchase price, then buying, never costs more than twice the optimal
 * offline schedule, without knowing how long the session will last. Evicting
 * eagerly (what naive context pruners do) has no such bound and, on real
 * Claude Code sessions, costs more than not pruning at all.
 *
 * When the cache has expired anyway (idle longer than its TTL) the purchase
 * is free, so we evict immediately.
 */

export interface DecayConfig {
  /** Requests an item must have been carried before it may be evicted. */
  minAge: number;
  /** Items saving fewer tokens than this are left alone. */
  minSaving: number;
  writeMultiplier: number;
  readMultiplier: number;
  /**
   * The provider has no prompt cache (many local and OpenAI-compatible
   * endpoints). Every request is billed in full, so eviction is always free.
   */
  uncached?: boolean;
  /** Tools whose output and inputs must never be stubbed. */
  skipTools?: readonly string[];
}

export const DEFAULT_DECAY: DecayConfig = {
  minAge: 5,
  minSaving: 150,
  writeMultiplier: CACHE_WRITE_MULTIPLIER,
  readMultiplier: CACHE_READ_MULTIPLIER,
};

/** Read decay overrides from the environment (DEJA_MIN_AGE, DEJA_MIN_SAVING). */
export function decayFromEnv(env: NodeJS.ProcessEnv = process.env, base: DecayConfig = DEFAULT_DECAY): DecayConfig {
  const num = (v: string | undefined) => {
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  return {
    ...base,
    minAge: num(env.DEJA_MIN_AGE) ?? base.minAge,
    minSaving: num(env.DEJA_MIN_SAVING) ?? base.minSaving,
    uncached: env.DEJA_UNCACHED === "1" ? true : base.uncached,
  };
}

/**
 * Tools whose output cannot be cheaply or safely re-created, so a stub's
 * "run the tool again" would be wrong: answers the user gave, reports from
 * whole subagent runs, and instructions the agent must keep following.
 * Their output never decays.
 */
export const NON_REPLAYABLE_TOOLS: ReadonlySet<string> = new Set([
  "AskUserQuestion",
  "Agent",
  "Task",
  "Skill",
  "ExitPlanMode",
  "EnterPlanMode",
  "TodoWrite",
  "ask_followup_question",
  "attempt_completion",
]);

export interface ConversationState {
  /** Rent paid since the last eviction, in base-token units. */
  rent: number;
  /** When this conversation last sent a request, epoch ms. */
  lastSeen?: number;
  /** Ids evicted so far. Sticky, so the evicted prefix stays cache-stable. */
  evicted: string[];
}

export function freshState(): ConversationState {
  return { rent: 0, evicted: [] };
}

export type DecayReason = "none" | "idle" | "rent" | "uncached";

export interface DecayDecision {
  /** Every id to stub on this request (previous and new evictions). */
  evict: Set<string>;
  newlyEvicted: Item[];
  reason: DecayReason;
  /** Stale tokens still being carried after this decision. */
  carried: number;
  rent: number;
  purchase: number;
}

/**
 * Decide what to evict for one request, updating `state` in place.
 * Pure apart from that mutation; `now` is injected for testability.
 */
export function decide(body: MessagesRequest, state: ConversationState, now: number, cfg: DecayConfig = DEFAULT_DECAY): DecayDecision {
  const inv = takeInventory(body);
  const evict = new Set(state.evicted);
  const skip = new Set([...NON_REPLAYABLE_TOOLS, ...(cfg.skipTools ?? [])]);
  const candidates = inv.items.filter(
    (it) => !evict.has(it.id) && !skip.has(it.tool) && it.age >= cfg.minAge && it.saving >= cfg.minSaving,
  );

  const idle = state.lastSeen === undefined || now - state.lastSeen > cacheTtlMs(body);
  state.lastSeen = now;

  if (candidates.length === 0) {
    return { evict, newlyEvicted: [], reason: "none", carried: 0, rent: state.rent, purchase: 0 };
  }

  const dead = candidates.reduce((n, it) => n + it.saving, 0);
  const p = Math.min(...candidates.map((it) => it.messageIndex));
  // Messages p..n-2 were in the previous request's cached prompt; the newest
  // message is uncached either way.
  let suffix = 0;
  for (let i = p; i < inv.messageTokens.length - 1; i++) suffix += inv.messageTokens[i]!;
  const free = idle || cfg.uncached === true;
  const purchase = free ? 0 : Math.max(0, (suffix - dead) * cfg.writeMultiplier - suffix * cfg.readMultiplier);

  if (free || state.rent + dead * cfg.readMultiplier >= purchase) {
    for (const it of candidates) evict.add(it.id);
    state.evicted = [...evict];
    state.rent = 0;
    const reason: DecayReason = cfg.uncached ? "uncached" : idle ? "idle" : "rent";
    return { evict, newlyEvicted: candidates, reason, carried: 0, rent: 0, purchase };
  }

  state.rent += dead * cfg.readMultiplier;
  return { evict, newlyEvicted: [], reason: "none", carried: dead, rent: state.rent, purchase };
}
