import { describe, expect, it } from "vitest";
import { aggregate, renderAudit } from "../src/audit/report.js";
import type { SessionStat } from "../src/audit/simulate.js";

function session(over: Partial<SessionStat> = {}): SessionStat {
  return {
    path: "/p/s.jsonl",
    cwd: "/home/me/app",
    start: Date.parse("2026-11-01"),
    end: Date.parse("2026-11-02"),
    requests: 10,
    toolResults: 5,
    compressed: 2,
    toolTokens: 1000,
    toolTokensSent: 10_000,
    saved: 300,
    savedSent: 3_000,
    weightedSaved: 500,
    targets: new Map([["Read a.ts", { target: "Read a.ts", tool: "Read", calls: 3, tokens: 900, saved: 300, savedSent: 3000 }]]),
    ...over,
  };
}

describe("aggregate", () => {
  it("sums sessions and prices weighted savings", () => {
    const r = aggregate([session(), session()], { model: "sonnet", env: {} });
    expect(r.sessions).toBe(2);
    expect(r.savedSent).toBe(6000);
    expect(r.usd).toBeCloseTo((1000 * 3) / 1e6);
    expect(r.topTargets[0]).toMatchObject({ target: "Read a.ts", calls: 6, savedSent: 6000 });
  });

  it("ignores sessions without requests", () => {
    expect(aggregate([session({ requests: 0 })], { env: {} }).sessions).toBe(0);
  });

  it("tracks the date range", () => {
    const r = aggregate([session(), session({ start: Date.parse("2026-10-01") })], { env: {} });
    expect(new Date(r.start!).toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("drops targets with no savings", () => {
    const s = session({
      targets: new Map([["Bash `ls`", { target: "Bash `ls`", tool: "Bash", calls: 1, tokens: 5, saved: 0, savedSent: 0 }]]),
    });
    expect(aggregate([s], { env: {} }).topTargets).toEqual([]);
  });
});

describe("renderAudit", () => {
  it("renders an empty audit", () => {
    expect(renderAudit(aggregate([], { env: {} }), false)).toContain("No Claude Code transcripts found");
  });

  it("renders totals, offenders and sessions", () => {
    const out = renderAudit(aggregate([session()], { env: {} }), false);
    expect(out).toContain("replaying 1 Claude Code sessions");
    expect(out).toContain("30.0%");
    expect(out).toContain("Read a.ts");
    expect(out).toContain("app");
  });
});
