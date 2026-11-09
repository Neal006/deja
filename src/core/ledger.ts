import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
  compressedResults: number;
  tokensBefore: number;
  tokensAfter: number;
  saved: number;
  usd: number;
  since?: number;
}

export function totals(entries: LedgerEntry[], since = 0): Totals {
  const t: Totals = { requests: 0, compressedResults: 0, tokensBefore: 0, tokensAfter: 0, saved: 0, usd: 0 };
  for (const e of entries) {
    if (e.t < since) continue;
    t.requests++;
    t.compressedResults += e.compressed;
    t.tokensBefore += e.tokensBefore;
    t.tokensAfter += e.tokensAfter;
    t.usd += e.usd;
    if (t.since === undefined || e.t < t.since) t.since = e.t;
  }
  t.saved = t.tokensBefore - t.tokensAfter;
  return t;
}
