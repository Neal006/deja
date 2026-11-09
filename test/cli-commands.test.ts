import { describe, expect, it } from "vitest";
import { buildReport, byModel, dailySaved, renderModels, renderReport } from "../src/cli/commands/stats.js";
import { eventLine, skipToolsFromArgs } from "../src/cli/commands/start.js";
import { parseArgs } from "../src/cli/args.js";
import { summaryLine } from "../src/cli/commands/wrap.js";
import type { LedgerEntry } from "../src/core/ledger.js";

const DAY = 86_400_000;
const NOW = 100 * DAY + DAY / 2; // midday, so "a second ago" is still today

function entry(t: number, saved: number): LedgerEntry {
  return { t, toolResults: 2, compressed: 1, tokensBefore: saved * 2, tokensAfter: saved, freshSaved: 0, usd: saved / 1e6 };
}

describe("buildReport", () => {
  it("splits entries into windows", () => {
    const r = buildReport([entry(NOW - 1000, 100), entry(NOW - 3 * DAY, 200), entry(NOW - 30 * DAY, 400)], NOW, undefined, "/l");
    expect(r.windows.map((w) => w.totals.saved)).toEqual([100, 300, 700]);
  });

  it("uses a single window with --since", () => {
    const r = buildReport([entry(NOW - 1000, 100), entry(NOW - 3 * DAY, 200)], NOW, 2 * DAY, "/l");
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]!.totals.saved).toBe(100);
  });
});

describe("dailySaved", () => {
  it("buckets savings by day ending today", () => {
    const d = dailySaved([entry(NOW - 1000, 10), entry(NOW - DAY, 5), entry(NOW - 30 * DAY, 99)], NOW, 3);
    expect(d).toEqual([0, 5, 10]);
  });
});

describe("renderReport", () => {
  it("explains how to start when empty", () => {
    expect(renderReport(buildReport([], NOW, undefined, "/l"), false)).toContain("deja claude");
  });

  it("shows savings and dollars", () => {
    const out = renderReport(buildReport([entry(NOW - 1000, 5000)], NOW, undefined, "/l"), false);
    expect(out).toContain("5.00k");
    expect(out).toContain("50.0%");
    expect(out).toContain("≈ $0.0050");
    expect(out).toContain("last 14 days");
  });
});

describe("renderReport with measured usage", () => {
  it("shows provider-reported cache split", () => {
    const e = { ...entry(NOW - 1000, 5000), in: 100, cr: 800, cw: 100, out: 50 };
    const out = renderReport(buildReport([e], NOW, undefined, "/l"), false);
    expect(out).toContain("measured by the provider");
    expect(out).toContain("cache reads 80.0%");
    expect(out).toContain("output tokens 50");
    expect(out).not.toContain("estimates run at");
  });

  it("reports estimator accuracy when estimates were recorded", () => {
    const e = { ...entry(NOW - 1000, 5000), in: 100, cr: 800, cw: 100, out: 50, est: 900 };
    expect(renderReport(buildReport([e], NOW, undefined, "/l"), false)).toContain("estimates run at 0.90×");
  });
});

describe("eventLine", () => {
  const base = { path: "/v1/messages", model: "m", ms: 1.23 };
  const z = { evictedResults: 0, evictedInputs: 0 };
  it("is quiet when nothing was saved", () => {
    expect(eventLine({ ...base, stats: { ...z, toolResults: 3, compressed: 0, tokensBefore: 10, tokensAfter: 10, freshSaved: 0 } }, false)).toContain(
      "nothing to trim",
    );
  });
  it("reports savings", () => {
    const line = eventLine({ ...base, stats: { ...z, toolResults: 3, compressed: 2, tokensBefore: 3000, tokensAfter: 1000, freshSaved: 500 } }, false);
    expect(line).toContain("2.00k tokens not resent");
    expect(line).toContain("2 deduped, 0 stubbed");
  });
  it("mentions decay evictions", () => {
    const line = eventLine(
      {
        ...base,
        stats: { ...z, evictedResults: 2, toolResults: 3, compressed: 0, tokensBefore: 3000, tokensAfter: 1000, freshSaved: 0 },
        decay: { reason: "idle", newlyEvicted: 2, evicted: 2 },
      },
      false,
    );
    expect(line).toContain("decayed 2 stale (idle)");
  });
});

describe("summaryLine", () => {
  it("handles no traffic", () => expect(summaryLine({ requests: 0, saved: 0, usd: 0 }, false)).toContain("no API requests"));
  it("handles nothing saved", () => expect(summaryLine({ requests: 4, saved: 0, usd: 0 }, false)).toContain("nothing repeated"));
  it("reports savings", () => expect(summaryLine({ requests: 4, saved: 12_345, usd: 0.5 }, false)).toContain("12.3k input tokens"));
});

describe("skipToolsFromArgs", () => {
  it("reads the flag", () => {
    expect(skipToolsFromArgs(parseArgs(["--skip-tools", "Read, mcp__db__query"]), {})).toEqual(["Read", "mcp__db__query"]);
  });
  it("falls back to the environment", () => {
    expect(skipToolsFromArgs(parseArgs([]), { DEJA_SKIP_TOOLS: "Grep" })).toEqual(["Grep"]);
  });
  it("defaults to nothing", () => {
    expect(skipToolsFromArgs(parseArgs([]), {})).toEqual([]);
  });
});

describe("byModel", () => {
  it("groups and sorts by savings", () => {
    const rows = byModel([
      { ...entry(NOW, 100), model: "claude-haiku-4-5" },
      { ...entry(NOW, 900), model: "claude-opus-4-5" },
      { ...entry(NOW, 50), model: "claude-opus-4-5" },
      entry(NOW, 10),
    ]);
    expect(rows.map((r) => [r.model, r.totals.saved])).toEqual([
      ["claude-opus-4-5", 950],
      ["claude-haiku-4-5", 100],
      ["unknown", 10],
    ]);
  });

  it("respects since", () => {
    expect(byModel([{ ...entry(5, 1), model: "a" }], 10)).toEqual([]);
  });

  it("renders rows", () => {
    const out = renderModels(byModel([{ ...entry(NOW, 2000), model: "claude-opus-4-5" }]), false);
    expect(out).toContain("claude-opus-4-5");
    expect(out).toContain("2.00k tokens");
  });

  it("renders an empty table", () => {
    expect(renderModels([], false)).toContain("No requests");
  });
});
