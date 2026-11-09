import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEntry, dejaHome, ledgerPath, readEntries, resetLedger, totals, type LedgerEntry } from "../src/core/ledger.js";

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return { t: 1000, toolResults: 3, compressed: 1, tokensBefore: 1000, tokensAfter: 400, freshSaved: 600, usd: 0.01, ...over };
}

describe("ledger", () => {
  it("resolves paths from DEJA_HOME", () => {
    expect(dejaHome({ DEJA_HOME: "/x" })).toBe("/x");
    expect(ledgerPath({ DEJA_HOME: "/x" })).toBe(join("/x", "ledger.jsonl"));
  });

  it("round-trips entries", () => {
    const path = join(mkdtempSync(join(tmpdir(), "deja-")), "sub", "ledger.jsonl");
    appendEntry(entry(), path);
    appendEntry(entry({ t: 2000 }), path);
    expect(readEntries(path)).toHaveLength(2);
  });

  it("returns nothing for a missing file", () => {
    expect(readEntries("/nonexistent/deja/ledger.jsonl")).toEqual([]);
  });

  it("skips a torn line", () => {
    const path = join(mkdtempSync(join(tmpdir(), "deja-")), "ledger.jsonl");
    appendEntry(entry(), path);
    appendFileSync(path, '{"t": 5, "tok');
    expect(readEntries(path)).toHaveLength(1);
  });

  it("resets by moving the ledger aside", () => {
    const path = join(mkdtempSync(join(tmpdir(), "deja-")), "ledger.jsonl");
    appendEntry(entry(), path);
    const backup = resetLedger(path, Date.parse("2026-11-09T10:00:00Z"));
    expect(backup).toBe(`${path}.2026-11-09T10-00-00-000Z.bak`);
    expect(readEntries(path)).toEqual([]);
    expect(readEntries(backup)).toHaveLength(1);
  });

  it("resets nothing when there is no ledger", () => {
    expect(resetLedger(join(mkdtempSync(join(tmpdir(), "deja-")), "none.jsonl"))).toBeUndefined();
  });

  it("totals measured usage separately", () => {
    const t = totals([entry({ in: 10, cr: 1000, cw: 50, out: 7 }), entry()]);
    expect(t.measured).toBe(1);
    expect([t.input, t.cacheRead, t.cacheWrite, t.output]).toEqual([10, 1000, 50, 7]);
  });

  it("totals entries since a time", () => {
    const t = totals([entry({ t: 1 }), entry({ t: 5 }), entry({ t: 10 })], 5);
    expect(t.requests).toBe(2);
    expect(t.saved).toBe(1200);
    expect(t.since).toBe(5);
    expect(t.usd).toBeCloseTo(0.02);
  });
});
