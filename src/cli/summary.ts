import { formatTokens } from "../core/tokens.js";
import { paint, usd } from "./format.js";

/** One line describing what a proxy saved, printed when it stops. */
export function summaryLine(t: { requests: number; saved: number; usd: number }, color: boolean): string {
  const p = paint(color);
  if (t.requests === 0) return p.dim("deja: no API requests went through the proxy");
  if (t.saved === 0) return p.dim(`deja: ${t.requests} requests, nothing repeated yet`);
  return (
    `${p.magenta("deja")} saved ${p.bold(formatTokens(t.saved))} input tokens ` +
    `across ${t.requests} requests ${p.dim(`(≈ ${usd(t.usd)})`)} · run ${p.cyan("deja stats")} for the full picture`
  );
}
