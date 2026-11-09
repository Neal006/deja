import { describe, expect, it } from "vitest";
import { calibrate } from "../src/core/calibration.js";
import type { LedgerEntry } from "../src/core/ledger.js";

function entry(est: number | undefined, provider: number | undefined): LedgerEntry {
  const e: LedgerEntry = { t: 0, toolResults: 0, compressed: 0, tokensBefore: 0, tokensAfter: 0, freshSaved: 0, usd: 0 };
  if (est !== undefined) e.est = est;
  if (provider !== undefined) Object.assign(e, { in: 10, cr: provider - 20, cw: 10 });
  return e;
}

describe("calibrate", () => {
  it("returns the provider-to-estimate ratio over measured requests", () => {
    const c = calibrate(Array.from({ length: 12 }, () => entry(700, 1000)))!;
    expect(c.factor).toBeCloseTo(1000 / 700);
    expect(c.requests).toBe(12);
  });

  it("ignores requests without both numbers", () => {
    const entries = [...Array.from({ length: 10 }, () => entry(500, 1000)), entry(undefined, 1000), entry(500, undefined)];
    expect(calibrate(entries)!.requests).toBe(10);
  });

  it("refuses to calibrate on too little data", () => {
    expect(calibrate(Array.from({ length: 3 }, () => entry(700, 1000)))).toBeUndefined();
  });

  it("clamps implausible factors", () => {
    expect(calibrate(Array.from({ length: 10 }, () => entry(100, 10_000)))!.factor).toBe(3);
    expect(calibrate(Array.from({ length: 10 }, () => entry(10_000, 100)))!.factor).toBe(0.5);
  });
});
