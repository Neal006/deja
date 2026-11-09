import { claudeProjectsDir, discoverTranscripts } from "../../audit/discover.js";
import { aggregate, renderAudit, renderProjects, renderShare, renderTune, type TuneRow } from "../../audit/report.js";
import { STRATEGIES, type Strategy } from "../../audit/replay.js";
import { simulateMany } from "../../audit/pool.js";
import { UNCACHED_BILLING } from "../../audit/billing.js";
import { calibrate } from "../../core/calibration.js";
import { readEntries } from "../../core/ledger.js";
import { DEFAULT_DECAY } from "../../decay/policy.js";
import { flagNumber, flagString, parseDuration, type ParsedArgs } from "../args.js";
import { useColor } from "../format.js";

/** Staleness thresholds tried by `deja audit --tune`. */
export const TUNE_AGES = [3, 5, 8, 12, 20];

export async function auditCommand(args: ParsedArgs): Promise<number> {
  const sinceFlag = flagString(args.flags, "since") ?? "30d";
  const since = parseDuration(sinceFlag);
  if (since === undefined) {
    process.stderr.write(`deja: could not parse --since ${sinceFlag} (try 7d, 2w)\n`);
    return 2;
  }
  const root = flagString(args.flags, "dir") ?? claudeProjectsDir();
  const files = discoverTranscripts(root, {
    since: Date.now() - since,
    match: flagString(args.flags, "project"),
    limit: flagNumber(args.flags, "limit"),
  });

  const color = useColor(process.stdout) && args.flags.color !== false;
  if (args.flags.tune === true) {
    const rows: TuneRow[] = [];
    for (const age of TUNE_AGES) {
      if (process.stderr.isTTY) process.stderr.write(`\r\x1b[2Ktrying --min-age ${age}…`);
      const stats = await simulateMany(
        files.map((f) => f.path),
        { strategies: ["baseline", "deja"], decay: { ...DEFAULT_DECAY, minAge: age }, jobs: flagNumber(args.flags, "jobs") },
      );
      const r = aggregate(stats, {});
      const base = r.bills.baseline?.cost ?? 0;
      const deja = r.bills.deja;
      if (!deja || base <= 0) continue;
      rows.push({ minAge: age, cut: 1 - deja.cost / base, rerunRate: deja.stubs ? (deja.reruns ?? 0) / deja.stubs : 0 });
    }
    if (process.stderr.isTTY) process.stderr.write("\r\x1b[2K");
    process.stdout.write(args.flags.json === true ? `${JSON.stringify(rows, null, 2)}\n` : `${renderTune(rows, color)}\n`);
    return 0;
  }
  const progress = process.stderr.isTTY && args.flags.json !== true;
  const strategies: readonly Strategy[] = args.flags.quick === true ? [] : STRATEGIES;
  const minAge = flagNumber(args.flags, "min-age");
  const uncached = args.flags.uncached === true;
  const decay = { ...DEFAULT_DECAY, ...(minAge !== undefined ? { minAge } : {}), ...(uncached ? { uncached: true } : {}) };
  const sessions = await simulateMany(
    files.map((f) => f.path),
    {
      strategies,
      decay,
      billing: uncached ? UNCACHED_BILLING : undefined,
      jobs: flagNumber(args.flags, "jobs"),
      onProgress: progress ? (done, total) => process.stderr.write(`\r\x1b[2Kreplaying ${done}/${total}…`) : undefined,
    },
  );
  if (progress) process.stderr.write("\r\x1b[2K");

  // Scale dollar figures by what deja has measured on real traffic, if enough.
  const calibration = args.flags.calibrate === false ? undefined : calibrate(readEntries());
  const report = aggregate(sessions, { model: flagString(args.flags, "model"), top: flagNumber(args.flags, "top"), uncached, calibration });
  if (args.flags.share === true) {
    process.stdout.write(`${renderShare(report)}\n`);
  } else if (args.flags.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderAudit(report, color)}\n`);
    if (args.flags["by-project"] === true) process.stdout.write(`\n${renderProjects(report, color)}\n`);
  }
  return 0;
}
