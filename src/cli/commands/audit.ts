import { claudeProjectsDir, discoverTranscripts } from "../../audit/discover.js";
import { aggregate, renderAudit, renderProjects, renderShare } from "../../audit/report.js";
import { STRATEGIES, type Strategy } from "../../audit/replay.js";
import { simulateMany } from "../../audit/pool.js";
import { UNCACHED_BILLING } from "../../audit/billing.js";
import { DEFAULT_DECAY } from "../../decay/policy.js";
import { flagNumber, flagString, parseDuration, type ParsedArgs } from "../args.js";
import { useColor } from "../format.js";

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

  const report = aggregate(sessions, { model: flagString(args.flags, "model"), top: flagNumber(args.flags, "top"), uncached });
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
