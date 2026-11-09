import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readEntries } from "../src/core/ledger.js";
import { recorder, toEntry } from "../src/proxy/record.js";
import type { ProxyEvent } from "../src/proxy/server.js";

const event: ProxyEvent = {
  path: "/v1/messages",
  model: "claude-sonnet-4-5",
  ms: 1,
  stats: { toolResults: 4, compressed: 2, tokensBefore: 10_000, tokensAfter: 4_000, freshSaved: 1_000 },
};

describe("toEntry", () => {
  it("copies counts and prices savings", () => {
    const e = toEntry(event, 42);
    expect(e.t).toBe(42);
    expect(e.compressed).toBe(2);
    expect(e.freshSaved).toBe(1_000);
    // 1000 fresh at 3.75/M + 5000 carried at 0.3/M
    expect(e.usd).toBeCloseTo(0.00375 + 0.0015);
  });
});

describe("recorder", () => {
  it("tallies and persists", () => {
    const path = join(mkdtempSync(join(tmpdir(), "deja-")), "ledger.jsonl");
    const r = recorder(path);
    r.onRequest(event);
    r.onRequest(event);
    expect(r.tally.requests).toBe(2);
    expect(r.tally.saved).toBe(12_000);
    expect(r.tally.fresh).toBe(2_000);
    expect(readEntries(path)).toHaveLength(2);
  });
});
