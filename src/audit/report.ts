import { basename } from "node:path";
import { inputPrice } from "../core/pricing.js";
import { formatTokens } from "../core/tokens.js";
import { bar, paint, percent, usd } from "../cli/format.js";
import type { SessionStat, TargetStat } from "./simulate.js";

export interface AuditReport {
  sessions: number;
  requests: number;
  toolResults: number;
  compressed: number;
  toolTokensSent: number;
  savedSent: number;
  weightedSaved: number;
  usd: number;
  pricePerMillion: number;
  start?: number;
  end?: number;
  topTargets: TargetStat[];
  topSessions: Array<{ path: string; cwd?: string; savedSent: number; toolTokensSent: number }>;
}

export function aggregate(sessions: SessionStat[], opts: { model?: string; top?: number; env?: NodeJS.ProcessEnv } = {}): AuditReport {
  const price = inputPrice(opts.model, opts.env);
  const top = opts.top ?? 8;
  const r: AuditReport = {
    sessions: 0,
    requests: 0,
    toolResults: 0,
    compressed: 0,
    toolTokensSent: 0,
    savedSent: 0,
    weightedSaved: 0,
    usd: 0,
    pricePerMillion: price,
    topTargets: [],
    topSessions: [],
  };
  const targets = new Map<string, TargetStat>();
  for (const s of sessions) {
    if (s.requests === 0) continue;
    r.sessions++;
    r.requests += s.requests;
    r.toolResults += s.toolResults;
    r.compressed += s.compressed;
    r.toolTokensSent += s.toolTokensSent;
    r.savedSent += s.savedSent;
    r.weightedSaved += s.weightedSaved;
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
      }
    }
    r.topSessions.push({ path: s.path, cwd: s.cwd, savedSent: s.savedSent, toolTokensSent: s.toolTokensSent });
  }
  r.usd = (r.weightedSaved * price) / 1_000_000;
  r.topTargets = [...targets.values()].filter((t) => t.savedSent > 0).sort((a, b) => b.savedSent - a.savedSent).slice(0, top);
  r.topSessions = r.topSessions.filter((s) => s.savedSent > 0).sort((a, b) => b.savedSent - a.savedSent).slice(0, 5);
  return r;
}

function day(ms: number | undefined): string {
  return ms === undefined ? "?" : new Date(ms).toISOString().slice(0, 10);
}

export function renderAudit(r: AuditReport, color: boolean): string {
  const p = paint(color);
  const out: string[] = [];
  out.push(`${p.magenta(p.bold("deja audit"))} ${p.dim(`— replaying ${r.sessions} Claude Code sessions, ${day(r.start)} → ${day(r.end)}`)}`);
  out.push("");
  if (r.sessions === 0) {
    out.push("No Claude Code transcripts found. Use Claude Code for a while, then run this again.");
    return out.join("\n");
  }
  const frac = r.toolTokensSent > 0 ? r.savedSent / r.toolTokensSent : 0;
  out.push(`  API requests replayed      ${p.bold(r.requests.toLocaleString("en-US"))}`);
  out.push(`  tool output sent to model  ${p.bold(formatTokens(r.toolTokensSent))} tokens ${p.dim("(counting every resend)")}`);
  out.push(`  of which the model had already seen`);
  out.push(`                             ${p.green(bar(frac, 28))} ${p.bold(p.green(formatTokens(r.savedSent)))} ${p.dim(`(${percent(r.savedSent, r.toolTokensSent)})`)}`);
  out.push(`  deja would have saved      ${p.bold(p.yellow(`≈ ${usd(r.usd)}`))} ${p.dim(`at $${r.pricePerMillion}/M input, cache-aware`)}`);
  out.push(`  results deduplicated       ${r.compressed.toLocaleString("en-US")} of ${r.toolResults.toLocaleString("en-US")}`);
  if (r.topTargets.length > 0) {
    out.push("");
    out.push(p.bold("  déjà vu hall of fame") + p.dim("  (what your agent kept re-reading)"));
    const width = Math.max(...r.topTargets.map((t) => t.target.length), 10);
    for (const t of r.topTargets) {
      out.push(`    ${t.target.padEnd(Math.min(width, 56)).slice(0, 56)}  ${String(t.calls).padStart(4)}×  ${p.green(formatTokens(t.savedSent).padStart(7))} saved`);
    }
  }
  if (r.topSessions.length > 0) {
    out.push("");
    out.push(p.bold("  heaviest sessions"));
    for (const s of r.topSessions) {
      const name = s.cwd ? basename(s.cwd) : basename(s.path);
      out.push(`    ${name.padEnd(28).slice(0, 28)}  ${p.green(formatTokens(s.savedSent).padStart(7))} of ${formatTokens(s.toolTokensSent)} ${p.dim(percent(s.savedSent, s.toolTokensSent))}`);
    }
  }
  out.push("");
  out.push(p.dim("  Estimates use a fast local token counter. Nothing left your machine."));
  out.push(`  Stop paying twice:  ${p.cyan("npx dejactx claude")}`);
  return out.join("\n");
}
