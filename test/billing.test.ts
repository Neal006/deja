import { describe, expect, it } from "vitest";
import { CacheBiller, messageHash, type BillingConfig } from "../src/audit/billing.js";

const cfg: BillingConfig = { systemTokens: 100, ttlMs: 1000, writeMultiplier: 1.25, readMultiplier: 0.1 };

describe("CacheBiller", () => {
  it("writes everything on the first request", () => {
    const b = new CacheBiller(cfg);
    expect(b.charge(["a", "b"], [10, 20], 0)).toBeCloseTo((100 + 30) * 1.25);
  });

  it("reads the shared prefix and writes the rest", () => {
    const b = new CacheBiller(cfg);
    b.charge(["a", "b"], [10, 20], 0);
    // system + a + b cached, c written
    expect(b.charge(["a", "b", "c"], [10, 20, 40], 10)).toBeCloseTo(130 * 0.1 + 40 * 1.25);
  });

  it("writes everything after the first changed message", () => {
    const b = new CacheBiller(cfg);
    b.charge(["a", "b", "c"], [10, 20, 30], 0);
    expect(b.charge(["a", "B", "c", "d"], [10, 5, 30, 1], 10)).toBeCloseTo(110 * 0.1 + 36 * 1.25);
  });

  it("writes everything after the TTL expires", () => {
    const b = new CacheBiller(cfg);
    b.charge(["a"], [10], 0);
    expect(b.charge(["a", "b"], [10, 10], 5000)).toBeCloseTo(120 * 1.25);
  });

  it("assumes a warm cache when times are unknown", () => {
    const b = new CacheBiller(cfg);
    b.charge(["a"], [10]);
    expect(b.charge(["a", "b"], [10, 10])).toBeCloseTo(110 * 0.1 + 10 * 1.25);
  });

  it("accumulates totals", () => {
    const b = new CacheBiller(cfg);
    b.charge(["a"], [10], 0);
    b.charge(["a", "b"], [10, 10], 1);
    expect(b.bill.requests).toBe(2);
    expect(b.bill.promptTokens).toBe(110 + 120);
    expect(b.bill.cachedTokens).toBe(110);
    expect(b.bill.lastPrompt).toBe(120);
  });
});

describe("messageHash", () => {
  it("is stable and content-sensitive", () => {
    const m = { role: "user" as const, content: "hi" };
    expect(messageHash(m)).toBe(messageHash({ ...m }));
    expect(messageHash(m)).not.toBe(messageHash({ role: "user", content: "hi!" }));
  });
});
