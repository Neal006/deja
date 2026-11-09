import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Append-only record of what deja saved. One JSON object per line, no
 * conversation content is ever written, only counts.
 */
export interface LedgerEntry {
  /** Unix epoch milliseconds. */
  t: number;
  model?: string;
  toolResults: number;
  compressed: number;
  tokensBefore: number;
  tokensAfter: number;
  freshSaved: number;
  usd: number;
  /** Provider-reported usage, when the response carried it. */
  in?: number;
  cr?: number;
  cw?: number;
  out?: number;
  /** deja's estimate of the prompt tokens sent, for calibration. */
  est?: number;
  /** Stubs newly applied on this request. */
  st?: number;
  /** Calls in this turn that re-targeted stubbed content. */
  rr?: number;
}

export function dejaHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEJA_HOME || join(homedir(), ".deja");
}

export function ledgerPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dejaHome(env), "ledger.jsonl");
}

export function appendEntry(entry: LedgerEntry, path = ledgerPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function readEntries(path = ledgerPath()): LedgerEntry[] {
  if (!existsSync(path)) return [];
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LedgerEntry);
    } catch {
      // A torn final line (e.g. crash mid-write) must not break stats.
    }
  }
  return out;
}

export interface Totals {
  requests: number;
  /** Requests whose provider-reported usage is known. */
  measured: number;
  /** Provider-reported uncached input tokens. */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** deja's estimate of prompt tokens, summed over measured requests. */
  estimated: number;
  /** Stub events and re-runs of stubbed content. */
  stubs: number;
  reruns: number;
  compressedResults: number;
  tokensBefore: number;
  tokensAfter: number;
  saved: number;
  usd: number;
  since?: number;
}

export function totals(entries: LedgerEntry[], since = 0): Totals {
  const t: Totals = {
    requests: 0,
    measured: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    estimated: 0,
    stubs: 0,
    reruns: 0,
    compressedResults: 0,
    tokensBefore: 0,
    tokensAfter: 0,
    saved: 0,
    usd: 0,
  };
  for (const e of entries) {
    if (e.t < since) continue;
    t.requests++;
    t.compressedResults += e.compressed;
    t.tokensBefore += e.tokensBefore;
    t.tokensAfter += e.tokensAfter;
    t.usd += e.usd;
    t.stubs += e.st ?? 0;
    t.reruns += e.rr ?? 0;
    if (e.in !== undefined) {
      t.measured++;
      t.input += e.in;
      t.cacheRead += e.cr ?? 0;
      t.cacheWrite += e.cw ?? 0;
      t.output += e.out ?? 0;
      t.estimated += e.est ?? 0;
    }
    if (t.since === undefined || e.t < t.since) t.since = e.t;
  }
  t.saved = t.tokensBefore - t.tokensAfter;
  return t;
}

/**
 * Start a fresh ledger. The old one is kept next to it with a timestamp,
 * never deleted. Returns the backup path, or undefined if there was none.
 */
export function resetLedger(path = ledgerPath(), now = Date.now()): string | undefined {
  if (!existsSync(path)) return undefined;
  const backup = `${path}.${new Date(now).toISOString().replace(/[:.]/g, "-")}.bak`;
  renameSync(path, backup);
  return backup;
}
