import { describe, expect, it } from "vitest";
import { buildReport, renderReport } from "../src/cli/commands/stats.js";
import { eventLine } from "../src/cli/commands/start.js";
import { summaryLine } from "../src/cli/commands/wrap.js";
import type { LedgerEntry } from "../src/core/ledger.js";

const DAY = 86_400_000;
const NOW = 100 * DAY;

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

describe("renderReport", () => {
  it("explains how to start when empty", () => {
    expect(renderReport(buildReport([], NOW, undefined, "/l"), false)).toContain("deja claude");
  });

  it("shows savings and dollars", () => {
    const out = renderReport(buildReport([entry(NOW - 1000, 5000)], NOW, undefined, "/l"), false);
    expect(out).toContain("5.00k");
    expect(out).toContain("50.0%");
    expect(out).toContain("≈ $0.0050");
  });
});

describe("eventLine", () => {
  const base = { path: "/v1/messages", model: "m", ms: 1.23 };
  it("is quiet when nothing was saved", () => {
    expect(eventLine({ ...base, stats: { toolResults: 3, compressed: 0, tokensBefore: 10, tokensAfter: 10, freshSaved: 0 } }, false)).toContain(
      "nothing seen before",
    );
  });
  it("reports savings", () => {
    const line = eventLine({ ...base, stats: { toolResults: 3, compressed: 2, tokensBefore: 3000, tokensAfter: 1000, freshSaved: 500 } }, false);
    expect(line).toContain("2.00k tokens not resent");
    expect(line).toContain("2/3 results deduped");
  });
});

describe("summaryLine", () => {
  it("handles no traffic", () => expect(summaryLine({ requests: 0, saved: 0, usd: 0 }, false)).toContain("no API requests"));
  it("handles nothing saved", () => expect(summaryLine({ requests: 4, saved: 0, usd: 0 }, false)).toContain("nothing repeated"));
  it("reports savings", () => expect(summaryLine({ requests: 4, saved: 12_345, usd: 0.5 }, false)).toContain("12.3k input tokens"));
});
