import { ledgerPath, readEntries, totals, type LedgerEntry, type Totals } from "../../core/ledger.js";
import { formatTokens } from "../../core/tokens.js";
import { flagString, parseDuration, type ParsedArgs } from "../args.js";
import { bar, paint, percent, sparkline, usd, useColor } from "../format.js";

const DAY = 86_400_000;

export interface StatsReport {
  ledger: string;
  windows: Array<{ name: string; totals: Totals }>;
  /** Tokens saved per day, oldest first, ending today. */
  daily: number[];
}

/** Saved tokens per calendar day (UTC) for the last `days` days. */
export function dailySaved(entries: LedgerEntry[], now: number, days = 14): number[] {
  const out = new Array<number>(days).fill(0);
  const today = Math.floor(now / DAY);
  for (const e of entries) {
    const idx = days - 1 - (today - Math.floor(e.t / DAY));
    if (idx >= 0 && idx < days) out[idx]! += e.tokensBefore - e.tokensAfter;
  }
  return out;
}

export function buildReport(entries: LedgerEntry[], now: number, since?: number, ledger = ledgerPath()): StatsReport {
  const daily = dailySaved(entries, now);
  if (since !== undefined) return { ledger, daily, windows: [{ name: "selected", totals: totals(entries, now - since) }] };
  return {
    ledger,
    daily,
    windows: [
      { name: "last 24h", totals: totals(entries, now - DAY) },
      { name: "last 7 days", totals: totals(entries, now - 7 * DAY) },
      { name: "all time", totals: totals(entries) },
    ],
  };
}

export function renderReport(report: StatsReport, color: boolean): string {
  const p = paint(color);
  const lines: string[] = [p.magenta(p.bold("deja")) + p.dim("  — context your agent did not pay for twice"), ""];
  const all = report.windows[report.windows.length - 1]!.totals;
  if (all.requests === 0) {
    lines.push("No requests recorded yet. Start with:  deja claude");
    lines.push(p.dim(`ledger: ${report.ledger}`));
    return lines.join("\n");
  }
  for (const w of report.windows) {
    const t = w.totals;
    const frac = t.tokensBefore > 0 ? t.saved / t.tokensBefore : 0;
    lines.push(
      `${w.name.padEnd(12)} ${p.green(bar(frac, 20))} ${p.bold(formatTokens(t.saved).padStart(7))} tokens ` +
        `${p.dim(`(${percent(t.saved, t.tokensBefore)} of tool output, ${t.requests} requests)`)}  ${p.yellow(`≈ ${usd(t.usd)}`)}`,
    );
  }
  if (report.daily.some((d) => d > 0)) {
    lines.push(`${"last 14 days".padEnd(12)} ${p.green(sparkline(report.daily))}`);
  }
  if (all.measured > 0) {
    const prompt = all.input + all.cacheRead + all.cacheWrite;
    lines.push("");
    lines.push(p.bold("measured by the provider") + p.dim(`  (${all.measured} requests)`));
    lines.push(
      `  prompt tokens ${p.bold(formatTokens(prompt))}  ` +
        p.dim(`cache reads ${percent(all.cacheRead, prompt)} · cache writes ${percent(all.cacheWrite, prompt)} · uncached ${percent(all.input, prompt)}`),
    );
    lines.push(`  output tokens ${p.bold(formatTokens(all.output))}`);
  }
  lines.push("");
  lines.push(p.dim(`"tokens" counts input tokens not resent to the model; dollars assume prompt caching.`));
  lines.push(p.dim(`ledger: ${report.ledger}`));
  return lines.join("\n");
}

export function statsCommand(args: ParsedArgs): number {
  const sinceFlag = flagString(args.flags, "since");
  const since = sinceFlag ? parseDuration(sinceFlag) : undefined;
  if (sinceFlag && since === undefined) {
    process.stderr.write(`deja: could not parse --since ${sinceFlag} (try 12h, 7d, 2w)\n`);
    return 2;
  }
  const path = ledgerPath();
  const report = buildReport(readEntries(path), Date.now(), since, path);
  if (args.flags.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(report, useColor(process.stdout) && args.flags.color !== false)}\n`);
  }
  return 0;
}
