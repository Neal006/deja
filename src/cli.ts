#!/usr/bin/env node
import { parseArgs } from "./cli/args.js";
import { auditCommand } from "./cli/commands/audit.js";
import { doctorCommand } from "./cli/commands/doctor.js";
import { previewCommand } from "./cli/commands/preview.js";
import { startCommand } from "./cli/commands/start.js";
import { statsCommand } from "./cli/commands/stats.js";
import { claudeCommand, runCommand } from "./cli/commands/wrap.js";
import { HELP, VERSION } from "./cli/help.js";

async function main(argv: string[]): Promise<number> {
  // For `deja claude ...` only flags *before* the subcommand belong to deja;
  // everything after it is Claude Code's.
  const claudeAt = argv.indexOf("claude");
  const own = claudeAt === -1 ? argv : argv.slice(0, claudeAt + 1);
  const args = parseArgs(own);

  if (args.flags.version === true || args.flags.v === true) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  switch (args.command) {
    case "claude":
      return claudeCommand(args, argv);
    case "run":
      return runCommand(args);
    case "start":
    case "proxy":
      return startCommand(args);
    case "stats":
      return statsCommand(args);
    case "audit":
      return auditCommand(args);
    case "preview":
      return previewCommand(args);
    case "doctor":
      return doctorCommand(args);
    case undefined:
    case "help":
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`deja: unknown command "${args.command}"\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`deja: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
