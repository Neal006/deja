import { appendEntry, ledgerPath, type LedgerEntry } from "../core/ledger.js";
import { dollarsSaved } from "../core/pricing.js";
import type { ProxyEvent } from "./server.js";

/** Convert a proxy event into a ledger entry. Pure, for testing. */
export function toEntry(event: ProxyEvent, now = Date.now()): LedgerEntry {
  const s = event.stats;
  const saved = s.tokensBefore - s.tokensAfter;
  const entry: LedgerEntry = {
    t: now,
    model: event.model,
    toolResults: s.toolResults,
    compressed: s.compressed,
    tokensBefore: s.tokensBefore,
    tokensAfter: s.tokensAfter,
    freshSaved: s.freshSaved,
    usd: dollarsSaved(event.model, s.freshSaved, saved),
  };
  if (event.usage) {
    entry.in = event.usage.input;
    entry.cr = event.usage.cacheRead;
    entry.cw = event.usage.cacheWrite;
    entry.out = event.usage.output;
  }
  return entry;
}

export interface SessionTally {
  requests: number;
  saved: number;
  fresh: number;
  usd: number;
}

/**
 * Returns an `onRequest` handler that persists every event and keeps an
 * in-memory tally for the current process.
 */
export function recorder(path = ledgerPath()): { onRequest: (e: ProxyEvent) => void; tally: SessionTally } {
  const tally: SessionTally = { requests: 0, saved: 0, fresh: 0, usd: 0 };
  return {
    tally,
    onRequest(event) {
      const entry = toEntry(event);
      tally.requests++;
      tally.saved += entry.tokensBefore - entry.tokensAfter;
      tally.fresh += entry.freshSaved;
      tally.usd += entry.usd;
      appendEntry(entry, path);
    },
  };
}
