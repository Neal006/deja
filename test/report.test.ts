import { describe, expect, it } from "vitest";
import { aggregate, dollars, dominantModel, recommend, renderAudit, renderProjects, renderShare, renderTune } from "../src/audit/report.js";
import type { Bill } from "../src/audit/billing.js";
import type { SessionStat } from "../src/audit/simulate.js";

function bill(cost: number, requests = 10): Bill {
  return { cost, cachedTokens: 0, writtenTokens: 0, promptTokens: cost * 10, requests, lastPrompt: 0 };
}

function session(over: Partial<SessionStat> = {}): SessionStat {
  return {
    path: "/p/s.jsonl",
    cwd: "/home/me/app",
    model: "claude-sonnet-4-5",
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
    targets: new Map([["Bash `npm test`", { target: "Bash `npm test`", tool: "Bash", calls: 3, tokens: 900, saved: 0, savedSent: 0, sent: 9000 }]]),
    bills: { baseline: bill(1_000_000), eager: bill(1_100_000), dedup: bill(990_000), deja: bill(700_000) },
    compactions: [],
    ...over,
  };
}

describe("aggregate", () => {
  it("sums sessions and bills", () => {
    const r = aggregate([session(), session()], { env: {} });
    expect(r.sessions).toBe(2);
    expect(r.requests).toBe(20);
    expect(r.bills.baseline!.cost).toBe(2_000_000);
    expect(r.bills.deja!.cost).toBe(1_400_000);
  });

  it("prices with the dominant model", () => {
    const r = aggregate([session({ model: "claude-opus-4-5", requests: 50 }), session()], { env: {} });
    expect(r.model).toBe("claude-opus-4-5");
    expect(r.pricePerMillion).toBe(5);
    expect(dollars(r, 1_000_000)).toBe(5);
  });

  it("lets an explicit model win", () => {
    expect(aggregate([session()], { model: "claude-haiku-4-5", env: {} }).pricePerMillion).toBe(1);
  });

  it("ranks context hogs by resend-weighted tokens", () => {
    const r = aggregate([session(), session()], { env: {} });
    expect(r.heaviest[0]).toMatchObject({ target: "Bash `npm test`", calls: 6, sent: 18_000 });
  });

  it("ignores sessions without requests", () => {
    expect(aggregate([session({ requests: 0 })], { env: {} }).sessions).toBe(0);
  });

  it("tracks the date range", () => {
    const r = aggregate([session(), session({ start: Date.parse("2026-10-01") })], { env: {} });
    expect(new Date(r.start!).toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("works without replayed bills", () => {
    const r = aggregate([session({ bills: undefined })], { env: {} });
    expect(r.bills).toEqual({});
    expect(r.topSessions).toEqual([]);
  });
});

describe("dominantModel", () => {
  it("weights by requests", () => {
    expect(dominantModel([session({ model: "a", requests: 1 }), session({ model: "b", requests: 5 })])).toBe("b");
  });
  it("is undefined without models", () => {
    expect(dominantModel([session({ model: undefined })])).toBeUndefined();
  });
});

describe("renderAudit", () => {
  it("renders an empty audit", () => {
    expect(renderAudit(aggregate([], { env: {} }), false)).toContain("No Claude Code transcripts found");
  });

  it("leads with the bill cut and the strategy table", () => {
    const out = renderAudit(aggregate([session()], { env: {} }), false);
    expect(out).toContain("deja would have cut your input bill by 30.0%");
    expect(out).toContain("eager pruning");
    expect(out).toMatch(/eager pruning\s+\$3\.30\s+\+10\.0%/);
    expect(out).toMatch(/deja\s+\$2\.10\s+-30\.0%/);
  });

  it("lists context hogs and wins", () => {
    const out = renderAudit(aggregate([session()], { env: {} }), false);
    expect(out).toContain("Bash `npm test`");
    expect(out).toContain("biggest wins");
    expect(out).toContain("app");
  });

  it("omits the table without bills", () => {
    const out = renderAudit(aggregate([session({ bills: undefined })], { env: {} }), false);
    expect(out).not.toContain("replayed under each strategy");
  });
});

describe("renderShare", () => {
  it("renders an aligned box and a badge", () => {
    const out = renderShare(aggregate([session()], { env: {} }));
    const lines = out.split("\n");
    const box = lines.filter((l) => l.startsWith("│"));
    expect(new Set(box.map((l) => [...l].length)).size).toBe(1);
    expect(out).toContain("input bill   $3.00 → $2.10  (-30.0%)");
    expect(out).toContain("eager pruning would have been +10.0%");
    expect(out).toContain("https://img.shields.io/badge/deja---30.0%25%20input%20bill-8a2be2");
  });

  it("explains itself without bills", () => {
    expect(renderShare(aggregate([session({ bills: undefined })], { env: {} }))).toContain("without --quick");
  });
});

describe("projects", () => {
  it("groups sessions by working directory, biggest first", () => {
    const r = aggregate([session(), session(), session({ cwd: "/home/me/small", bills: { baseline: bill(10), deja: bill(5) } })], { env: {} });
    expect(r.projects.map((p) => [p.project, p.sessions])).toEqual([
      ["/home/me/app", 2],
      ["/home/me/small", 1],
    ]);
  });

  it("renders a table", () => {
    const out = renderProjects(aggregate([session()], { env: {} }), false);
    expect(out).toContain("by project");
    expect(out).toMatch(/app\s+1 sessions\s+10 req\s+\$3\.00 →\s+\$2\.10\s+-30\.0%/);
  });

  it("explains an empty table", () => {
    expect(renderProjects(aggregate([session({ bills: undefined })], { env: {} }), false)).toContain("without --quick");
  });
});

describe("compactions", () => {
  it("aggregates and renders headroom at compaction points", () => {
    const r = aggregate(
      [session({ compactions: [{ baseline: 160_000, deja: 100_000 }] }), session({ compactions: [{ baseline: 140_000, deja: 80_000 }] })],
      { env: {} },
    );
    expect(r.compactions).toEqual({ count: 2, baseline: 300_000, deja: 180_000 });
    const out = renderAudit(r, false);
    expect(out).toContain("2 auto-compactions");
    expect(out).toContain("150.0k");
    expect(out).toContain("90.0k");
    expect(out).toContain("40.0% more headroom");
  });

  it("stays quiet without compactions", () => {
    expect(renderAudit(aggregate([session()], { env: {} }), false)).not.toContain("auto-compactions");
  });
});

describe("stub re-runs", () => {
  it("reports how rarely stubbed output was needed again", () => {
    const s = session({ bills: { baseline: bill(1_000_000), deja: { ...bill(700_000), stubs: 200, reruns: 6 } } });
    const out = renderAudit(aggregate([s], { env: {} }), false);
    expect(out).toContain("deja would have stubbed 200 stale outputs. Your agent called the same target again later for 6 of them (3.0%),");
    expect(out).toContain("re-runs that happened without deja");
  });
});

describe("subagents", () => {
  it("counts subagent sessions in the header", () => {
    const r = aggregate([session(), session({ subagent: true })], { env: {} });
    expect(r.subagents).toBe(1);
    expect(renderAudit(r, false)).toContain("2 Claude Code sessions (1 of them subagents)");
  });
});

describe("uncached reports", () => {
  it("say that nothing was cached", () => {
    const out = renderAudit(aggregate([session()], { env: {}, uncached: true }), false);
    expect(out).toContain("no prompt cache");
  });
});

describe("tuning", () => {
  const rows = [
    { minAge: 3, cut: 0.324, rerunRate: 0.3 },
    { minAge: 5, cut: 0.318, rerunRate: 0.25 },
    { minAge: 8, cut: 0.29, rerunRate: 0.2 },
  ];

  it("prefers a more conservative setting within two points of the best", () => {
    expect(recommend(rows)!.minAge).toBe(5);
  });

  it("takes the best when nothing else is close", () => {
    expect(recommend([{ minAge: 3, cut: 0.4, rerunRate: 0 }, { minAge: 8, cut: 0.37, rerunRate: 0 }])!.minAge).toBe(3);
  });

  it("returns nothing without rows", () => {
    expect(recommend([])).toBeUndefined();
  });

  it("renders the sweep with a recommendation", () => {
    const out = renderTune(rows, false);
    expect(out).toMatch(/--min-age 5 +31\.8% +25\.0% re-run ← recommended/);
    expect(out).toContain("deja --min-age 5 claude");
  });
});
