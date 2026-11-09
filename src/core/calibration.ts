import type { LedgerEntry } from "./ledger.js";

/**
 * Self-calibration of the token estimator.
 *
 * deja's estimator is fast but approximate. Every proxied request records
 * both deja's estimate of the prompt (`est`) and the provider's own count
 * (`in + cr + cw`). Their ratio over real traffic is a correction factor
 * that turns estimated tokens (and dollars) into provider tokens.
 */

export interface Calibration {
  /** Multiply estimated tokens by this to get provider tokens. */
  factor: number;
  /** Requests the factor is based on. */
  requests: number;
}

/** Fewer measured requests than this and we do not trust a factor. */
export const MIN_CALIBRATION_REQUESTS = 10;
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 3;

export function calibrate(entries: LedgerEntry[], minRequests = MIN_CALIBRATION_REQUESTS): Calibration | undefined {
  let est = 0;
  let provider = 0;
  let requests = 0;
  for (const e of entries) {
    if (e.est === undefined || e.est <= 0 || e.in === undefined) continue;
    const p = e.in + (e.cr ?? 0) + (e.cw ?? 0);
    if (p <= 0) continue;
    est += e.est;
    provider += p;
    requests++;
  }
  if (requests < minRequests || est <= 0) return undefined;
  const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, provider / est));
  return { factor, requests };
}
