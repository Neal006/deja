import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEntry, dejaHome, ledgerPath, readEntries, totals, type LedgerEntry } from "../src/core/ledger.js";

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return { t: 1000, toolResults: 3, compressed: 1, tokensBefore: 1000, tokensAfter: 400, freshSaved: 600, usd: 0.01, ...over };
}

describe("ledger", () => {
  it("resolves paths from DEJA_HOME", () => {
    expect(dejaHome({ DEJA_HOME: "/x" })).toBe("/x");
    expect(ledgerPath({ DEJA_HOME: "/x" })).toBe("/x/ledger.jsonl");
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

  it("totals entries since a time", () => {
    const t = totals([entry({ t: 1 }), entry({ t: 5 }), entry({ t: 10 })], 5);
    expect(t.requests).toBe(2);
    expect(t.saved).toBe(1200);
    expect(t.since).toBe(5);
    expect(t.usd).toBeCloseTo(0.02);
  });
});
