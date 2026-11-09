import { claudeProjectsDir, discoverTranscripts } from "../../audit/discover.js";
import { aggregate, renderAudit } from "../../audit/report.js";
import { simulate, type SessionStat } from "../../audit/simulate.js";
import { readTranscript } from "../../audit/transcript.js";
import { flagNumber, flagString, parseDuration, type ParsedArgs } from "../args.js";
import { useColor } from "../format.js";

export function auditCommand(args: ParsedArgs): number {
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
  const sessions: SessionStat[] = [];
  files.forEach((f, i) => {
    if (progress) process.stderr.write(`\r\x1b[2Kreplaying ${i + 1}/${files.length}…`);
    try {
      sessions.push(simulate(readTranscript(f.path)));
    } catch {
      // One unreadable transcript should not sink the whole audit.
    }
  });
  if (progress) process.stderr.write("\r\x1b[2K");

  const report = aggregate(sessions, { model: flagString(args.flags, "model"), top: flagNumber(args.flags, "top") });
  if (args.flags.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderAudit(report, color)}\n`);
  }
  return 0;
}
