import { describe, expect, it } from "vitest";
import type { MessagesRequest } from "../src/anthropic/types.js";
import { decide, DEFAULT_DECAY, freshState } from "../src/decay/policy.js";
import { Conversation } from "./helpers/conversation.js";

const log = Array.from({ length: 200 }, (_, i) => `PASS test/suite-${i}.test.ts (${i} ms) all good here`).join("\n");
const MIN = 60_000;

/** A conversation whose first tool result is `turns` requests old. */
function session(turns: number, filler = "ok"): MessagesRequest {
  const c = new Conversation().tool("Bash", { command: "npm test" }, log);
  for (let i = 0; i < turns; i++) c.tool("Bash", { command: `echo ${i}` }, filler);
  return c.build();
}

describe("decide", () => {
  it("does nothing while items are young", () => {
    const s = freshState();
    s.lastSeen = 0;
    const d = decide(session(2), s, MIN);
    expect(d.reason).toBe("none");
    expect(d.evict.size).toBe(0);
  });

  it("evicts for free when the cache has gone cold", () => {
    const s = freshState();
    s.lastSeen = 0;
    const d = decide(session(6), s, 10 * MIN);
    expect(d.reason).toBe("idle");
    expect([...d.evict]).toEqual(["toolu_0001"]);
    expect(s.evicted).toEqual(["toolu_0001"]);
    expect(s.rent).toBe(0);
  });

  it("treats an unknown conversation as cold", () => {
    expect(decide(session(6), freshState(), 0).reason).toBe("idle");
  });

  it("pays rent while the purchase is expensive, then buys", () => {
    // A large cached suffix after the stale item makes eviction expensive.
    const bigFiller = Array.from({ length: 300 }, (_, i) => `row ${i} with some text`).join("\n");
    const s = freshState();
    s.lastSeen = 0;
    let t = 0;
    const reasons: string[] = [];
    for (let k = 0; k < 400 && reasons[reasons.length - 1] !== "rent"; k++) {
      t += MIN;
      reasons.push(decide(session(6, bigFiller), s, t).reason);
    }
    expect(reasons[0]).toBe("none");
    expect(reasons[reasons.length - 1]).toBe("rent");
    expect(s.evicted).toContain("toolu_0001");
  });

  it("buys immediately when the suffix is cheap", () => {
    const s = freshState();
    s.lastSeen = 0;
    expect(decide(session(6), s, MIN).reason).toBe("rent");
  });

  it("keeps earlier evictions sticky", () => {
    const s = freshState();
    s.evicted = ["toolu_0001"];
    s.lastSeen = 0;
    const d = decide(session(1), s, MIN);
    expect(d.evict.has("toolu_0001")).toBe(true);
  });

  it("respects the minimum age", () => {
    const s = freshState();
    const d = decide(session(6), s, 0, { ...DEFAULT_DECAY, minAge: 50 });
    expect(d.evict.size).toBe(0);
  });

  it("updates lastSeen", () => {
    const s = freshState();
    decide(session(0), s, 1234);
    expect(s.lastSeen).toBe(1234);
  });
});
