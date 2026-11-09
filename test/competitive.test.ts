import { describe, expect, it } from "vitest";
import { CacheBiller, messageHash, type BillingConfig } from "../src/audit/billing.js";
import { IncrementalTransformer } from "../src/anthropic/incremental.js";
import type { Message } from "../src/anthropic/types.js";
import { messageTokens } from "../src/decay/inventory.js";
import { decide, DEFAULT_DECAY, freshState } from "../src/decay/policy.js";
import { Conversation } from "./helpers/conversation.js";

/**
 * Ski-rental guarantee, checked end to end: for one stale tool output in a
 * session of unknown length, deja's billed cost must stay within 2x (plus a
 * little slack for the coarse cost model) of the best eviction schedule
 * chosen in hindsight, among "never" and "evict from request t onward".
 */

const BILLING: BillingConfig = { systemTokens: 2000, ttlMs: Number.MAX_SAFE_INTEGER, writeMultiplier: 1.25, readMultiplier: 0.1 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A session: one early tool output (the eviction candidate), then `turns`
 * round trips. Half the seeds make later output large relative to the
 * candidate, so evicting means rewriting a big cached suffix and the
 * policy has to pay rent before buying.
 */
function session(r: () => number) {
  const expensive = r() < 0.5;
  const bigLines = expensive ? 40 + Math.floor(r() * 100) : 100 + Math.floor(r() * 900);
  const big = Array.from({ length: bigLines }, (_, i) => `PASS test/suite-${i}.test.ts (${i} ms) fine and dandy`).join("\n");
  const turns = 3 + Math.floor(r() * 60);
  const filler = expensive ? 60 + Math.floor(r() * 200) : 1 + Math.floor(r() * 40);
  const conv = new Conversation().tool("Bash", { command: "npm test" }, big);
  for (let i = 0; i < turns; i++) {
    conv.tool("Bash", { command: `step ${i}` }, Array.from({ length: filler }, (_, k) => `line ${k} of step ${i}`).join("\n"));
  }
  const messages = conv.build().messages;
  messages.push({ role: "assistant", content: [{ type: "text", text: "done" }] });
  return messages;
}

/** Bill a session where evictions are chosen by `pick(request index, prompt)`. */
function bill(messages: Message[], pick: (k: number, prompt: Message[]) => Set<string>): number {
  const biller = new CacheBiller(BILLING);
  const engine = new IncrementalTransformer();
  let k = 0;
  for (let j = 1; j < messages.length; j++) {
    if (messages[j]!.role !== "assistant") continue;
    const prompt = messages.slice(0, j);
    const sent = engine.transform({ messages: prompt }, { evict: pick(k++, prompt) }).body.messages;
    biller.charge(sent.map(messageHash), sent.map(messageTokens), j);
  }
  return biller.bill.cost;
}

describe("ski-rental competitiveness", () => {
  let worst = 0;
  /** Seeds where deja paid rent for a while and then evicted. */
  let rentedThenBought = 0;
  /** Seeds where deja never evicted. */
  let neverBought = 0;
  for (let seed = 1; seed <= 40; seed++) {
    it(`seed ${seed}`, { timeout: 30_000 }, () => {
      const r = rng(seed);
      const messages = session(r);
      const requests = messages.filter((m) => m.role === "assistant").length;

      // deja, with its real policy. With a minimum age of 1 the output has
      // been sent (and cached) once before it may be evicted, so eviction
      // is never free and only the economics decide when to do it.
      const state = freshState();
      state.lastSeen = 0;
      const cfg = { ...DEFAULT_DECAY, minAge: 1, minSaving: 0 };
      let boughtAt = -1;
      const deja = bill(messages, (k, prompt) => {
        // Only the big output is a candidate: decide on it alone.
        const d = decide({ messages: prompt }, state, 1, cfg);
        const ev = new Set([...d.evict].filter((id) => id === "toolu_0001"));
        if (ev.size > 0 && boughtAt < 0) boughtAt = k;
        return ev;
      });
      if (boughtAt > 1) rentedThenBought++;
      if (boughtAt < 0) neverBought++;

      // Offline optimum over "never" and "from request t on", under the same
      // constraint (request 0 is the one where the output is first sent).
      let opt = bill(messages, () => new Set());
      for (let t = 1; t < requests; t++) {
        opt = Math.min(opt, bill(messages, (k) => (k >= t ? new Set(["toolu_0001"]) : new Set())));
      }
      worst = Math.max(worst, deja / opt);
      expect(deja).toBeLessThanOrEqual(2 * opt * 1.05);
    });
  }
  it("summary", () => {
    // Keep a record of how close to the 2x bound real decisions come.
    console.log(
      `worst deja / hindsight-optimal ratio: ${worst.toFixed(3)} · rented then bought: ${rentedThenBought} · never bought: ${neverBought}`,
    );
    // The rent phase must actually be exercised for this test to mean anything.
    expect(rentedThenBought).toBeGreaterThan(0);
    // Nothing can beat the hindsight optimum.
    expect(worst).toBeGreaterThanOrEqual(0.999);
  });
});
