import { basename } from "node:path";
import { bar, paint, percent, usd } from "../cli/format.js";
import { inputPrice } from "../core/pricing.js";
import { formatTokens } from "../core/tokens.js";
import { addBill, emptyBill, STRATEGIES, type Strategy, type StrategyBills } from "./replay.js";
import type { SessionStat, TargetStat } from "./simulate.js";

export interface AuditReport {
  /** Model used for pricing. */
  model?: string;
  sessions: number;
  requests: number;
  toolResults: number;
  compressed: number;
  /** Tool output tokens multiplied by resends. */
  toolTokensSent: number;
  /** Already-seen tool output, multiplied by resends. */
  savedSent: number;
  pricePerMillion: number;
  start?: number;
  end?: number;
  /** Cache-aware bills per strategy (only strategies that were replayed). */
  bills: Partial<StrategyBills>;
  /** Tool outputs that cost the most in context, resends included. */
  heaviest: TargetStat[];
  topSessions: Array<{ path: string; cwd?: string; baseline: number; deja: number; requests: number }>;
  /** Per working directory: sessions, requests and bills, biggest first. */
  projects: ProjectRow[];
  /** Auto-compactions seen, and the context size at those moments. */
  compactions: { count: number; baseline: number; deja: number };
}

export interface ProjectRow {
  project: string;
  sessions: number;
  requests: number;
  baseline: number;
  deja: number;
}

export interface AggregateOptions {
  model?: string;
  top?: number;
  env?: NodeJS.ProcessEnv;
}

/** The model used in the most requests, to price the report. */
export function dominantModel(sessions: SessionStat[]): string | undefined {
  const counts = new Map<string, number>();
  for (const s of sessions) if (s.model) counts.set(s.model, (counts.get(s.model) ?? 0) + s.requests);
  let best: string | undefined;
  let n = -1;
  for (const [m, c] of counts) if (c > n) [best, n] = [m, c];
  return best;
}

export function aggregate(sessions: SessionStat[], opts: AggregateOptions = {}): AuditReport {
  const model = opts.model ?? dominantModel(sessions);
  const r: AuditReport = {
    model,
    sessions: 0,
    requests: 0,
    toolResults: 0,
    compressed: 0,
    toolTokensSent: 0,
    savedSent: 0,
    pricePerMillion: inputPrice(model, opts.env),
    bills: {},
    heaviest: [],
    topSessions: [],
    projects: [],
    compactions: { count: 0, baseline: 0, deja: 0 },
  };
  const projects = new Map<string, ProjectRow>();
  const targets = new Map<string, TargetStat>();
  for (const s of sessions) {
    if (s.requests === 0) continue;
    r.sessions++;
    r.requests += s.requests;
    r.toolResults += s.toolResults;
    r.compressed += s.compressed;
    r.toolTokensSent += s.toolTokensSent;
    r.savedSent += s.savedSent;
    if (s.start !== undefined) r.start = r.start === undefined ? s.start : Math.min(r.start, s.start);
    if (s.end !== undefined) r.end = r.end === undefined ? s.end : Math.max(r.end, s.end);
    for (const t of s.targets.values()) {
      const agg = targets.get(t.target);
      if (!agg) targets.set(t.target, { ...t });
      else {
        agg.calls += t.calls;
        agg.tokens += t.tokens;
        agg.saved += t.saved;
        agg.savedSent += t.savedSent;
        agg.sent += t.sent;
      }
    }
    for (const c of s.compactions ?? []) {
      r.compactions.count++;
      r.compactions.baseline += c.baseline;
      r.compactions.deja += c.deja;
    }
    for (const k of STRATEGIES) {
      const b = s.bills?.[k];
      if (b) r.bills[k] = addBill(r.bills[k] ?? emptyBill(), b);
    }
    if (s.bills?.baseline && s.bills.deja) {
      r.topSessions.push({ path: s.path, cwd: s.cwd, baseline: s.bills.baseline.cost, deja: s.bills.deja.cost, requests: s.requests });
      const name = s.cwd ?? "(unknown)";
      const row = projects.get(name) ?? { project: name, sessions: 0, requests: 0, baseline: 0, deja: 0 };
      row.sessions++;
      row.requests += s.requests;
      row.baseline += s.bills.baseline.cost;
      row.deja += s.bills.deja.cost;
      projects.set(name, row);
    }
  }
  r.heaviest = [...targets.values()].filter((t) => t.sent > 0).sort((a, b) => b.sent - a.sent).slice(0, opts.top ?? 8);
  r.projects = [...projects.values()].sort((a, b) => b.baseline - a.baseline);
  r.topSessions = r.topSessions.sort((a, b) => b.baseline - b.deja - (a.baseline - a.deja)).slice(0, 5);
  return r;
}

/** Dollars for a cost expressed in base-input-token units. */
export function dollars(r: AuditReport, units: number): number {
  return (units * r.pricePerMillion) / 1_000_000;
}

const LABELS: Record<Strategy, string> = {
  baseline: "as it happened",
  eager: "eager pruning",
  dedup: "deja, dedup only",
  deja: "deja",
};

const NOTES: Record<Strategy, string> = {
  baseline: "",
  eager: "what typical context pruners do",
  dedup: "cache-neutral back-references",
  deja: "dedup + cache-aware decay",
};

function day(ms: number | undefined): string {
  return ms === undefined ? "?" : new Date(ms).toISOString().slice(0, 10);
}

function signed(fraction: number): string {
  const pct = (fraction * 100).toFixed(1);
  return fraction > 0 ? `-${pct}%` : `+${(-fraction * 100).toFixed(1)}%`;
}

export function renderAudit(r: AuditReport, color: boolean): string {
  const p = paint(color);
  const out: string[] = [];
  out.push(`${p.magenta(p.bold("deja audit"))} ${p.dim(`— ${r.sessions} Claude Code sessions, ${r.requests.toLocaleString("en-US")} API requests, ${day(r.start)} → ${day(r.end)}`)}`);
  out.push("");
  if (r.sessions === 0) {
    out.push("No Claude Code transcripts found. Use Claude Code for a while, then run this again.");
    return out.join("\n");
  }

  const base = r.bills.baseline;
  const deja = r.bills.deja;
  if (base && deja && base.cost > 0) {
    const cut = 1 - deja.cost / base.cost;
    out.push(
      `  ${p.bold("deja would have cut your input bill by")} ${p.bold(p.green(`${(cut * 100).toFixed(1)}%`))}` +
        p.dim(` (≈ ${usd(dollars(r, base.cost - deja.cost))} at $${r.pricePerMillion}/M input${r.model ? `, ${r.model}` : ""})`),
    );
    out.push(
      `  ${p.dim("average prompt")} ${formatTokens(Math.round(base.promptTokens / base.requests))} ${p.dim("→")} ${p.bold(formatTokens(Math.round(deja.promptTokens / deja.requests)))} ${p.dim("tokens")}`,
    );
    out.push("");
    out.push(p.bold("  replayed under each strategy") + p.dim("  (prompt-cache billing, exact prefix matching)"));
    for (const k of STRATEGIES) {
      const b = r.bills[k];
      if (!b) continue;
      const frac = 1 - b.cost / base.cost;
      const delta = k === "baseline" ? "".padStart(7) : signed(frac).padStart(7);
      const tint = k === "baseline" ? delta : frac >= 0 ? p.green(delta) : p.red(delta);
      out.push(`    ${LABELS[k].padEnd(18)} ${usd(dollars(r, b.cost)).padStart(9)} ${tint}  ${p.dim(NOTES[k])}`.trimEnd());
    }
  }

  if (r.compactions.count > 0) {
    const c = r.compactions;
    const before = c.baseline / c.count;
    const after = c.deja / c.count;
    out.push("");
    out.push(
      `  ${p.bold(`${c.count} auto-compactions`)} ${p.dim("in this history. When they fired, the context held")} ${formatTokens(Math.round(before))} ${p.dim("tokens on average;")}`,
    );
    out.push(
      `  ${p.dim("with deja it would have held")} ${p.bold(p.green(formatTokens(Math.round(after))))} ${p.dim(`(${percent(before - after, before)} more headroom before compacting)`)}`,
    );
  }

  const frac = r.toolTokensSent > 0 ? r.savedSent / r.toolTokensSent : 0;
  out.push("");
  out.push(`  ${p.dim("tool output resent to the model")} ${p.bold(formatTokens(r.toolTokensSent))} ${p.dim("tokens")}`);
  out.push(`  ${p.dim("exact repeats the model had already seen")} ${p.green(bar(frac, 16))} ${formatTokens(r.savedSent)} ${p.dim(`(${percent(r.savedSent, r.toolTokensSent)})`)}`);

  if (r.heaviest.length > 0) {
    out.push("");
    out.push(p.bold("  context hogs") + p.dim("  (tool output × the number of requests that dragged it along)"));
    for (const t of r.heaviest) {
      const name = t.target.length > 52 ? `${t.target.slice(0, 51)}…` : t.target;
      out.push(`    ${name.padEnd(52)} ${String(t.calls).padStart(4)}×  ${p.yellow(formatTokens(t.sent).padStart(7))}`);
    }
  }
  if (r.topSessions.length > 0) {
    out.push("");
    out.push(p.bold("  biggest wins"));
    for (const s of r.topSessions) {
      const name = s.cwd ? basename(s.cwd) : basename(s.path);
      out.push(
        `    ${name.padEnd(28).slice(0, 28)} ${String(s.requests).padStart(5)} requests  ${usd(dollars(r, s.baseline)).padStart(8)} → ${p.green(usd(dollars(r, s.deja)).padStart(8))}`,
      );
    }
  }
  out.push("");
  out.push(p.dim("  Local estimates: a fast token counter and a model of Anthropic prompt caching. Nothing left your machine."));
  out.push(`  Stop paying for stale context:  ${p.cyan("npx dejactx claude")}`);
  return out.join("\n");
}

const REPO = "github.com/Neal006/deja";

/** Pad a string to a display width, counting each code point as one column. */
function padDisplay(s: string, width: number): string {
  const len = [...s].length;
  return len >= width ? s : s + " ".repeat(width - len);
}

/**
 * A compact, content-free summary meant to be pasted into a post or README:
 * a box with the headline numbers and a shields.io badge.
 */
/** A per-project table (shown with `deja audit --by-project`). */
export function renderProjects(r: AuditReport, color: boolean, limit = 15): string {
  const p = paint(color);
  if (r.projects.length === 0) return p.dim("No replayed projects (run without --quick).");
  const out = [p.bold("  by project") + p.dim("  (input bill as recorded → with deja)")];
  for (const row of r.projects.slice(0, limit)) {
    const name = basename(row.project).padEnd(28).slice(0, 28);
    const cut = row.baseline > 0 ? signed(1 - row.deja / row.baseline) : "";
    out.push(
      `    ${name} ${String(row.sessions).padStart(3)} sessions ${String(row.requests).padStart(6)} req  ` +
        `${usd(dollars(r, row.baseline)).padStart(8)} → ${p.green(usd(dollars(r, row.deja)).padStart(8))}  ${p.dim(cut)}`,
    );
  }
  if (r.projects.length > limit) out.push(p.dim(`    … ${r.projects.length - limit} more`));
  return out.join("\n");
}

export function renderShare(r: AuditReport): string {
  const base = r.bills.baseline;
  const deja = r.bills.deja;
  const eager = r.bills.eager;
  if (!base || !deja || base.cost <= 0) return "Run `deja audit` without --quick to get a shareable summary.";
  const cut = 1 - deja.cost / base.cost;
  const rows = [
    `deja audit · ${r.sessions} sessions · ${r.requests.toLocaleString("en-US")} requests`,
    `input bill   ${usd(dollars(r, base.cost))} → ${usd(dollars(r, deja.cost))}  (${signed(cut)})`,
    `avg prompt   ${formatTokens(Math.round(base.promptTokens / base.requests))} → ${formatTokens(Math.round(deja.promptTokens / deja.requests))} tokens`,
    ...(eager ? [`eager pruning would have been ${signed(1 - eager.cost / base.cost)}`] : []),
    REPO,
  ];
  const width = Math.max(...rows.map((x) => [...x].length)) + 2;
  const box = [
    `┌${"─".repeat(width)}┐`,
    ...rows.map((x) => `│ ${padDisplay(x, width - 1)}│`),
    `└${"─".repeat(width)}┘`,
  ];
  const pct = `-${(cut * 100).toFixed(1)}%`;
  const badge = `[![deja](https://img.shields.io/badge/deja-${encodeURIComponent(`${pct} input bill`).replace(/-/g, "--")}-8a2be2)](https://${REPO})`;
  return [...box, "", badge].join("\n");
}
