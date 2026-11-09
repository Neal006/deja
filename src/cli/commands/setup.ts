import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ParsedArgs } from "../args.js";

/**
 * `deja setup statusline`: add deja's status line to Claude Code settings.
 * Never clobbers a status line the user already has unless --force is
 * given, and always backs the file up before writing.
 */

export const STATUSLINE_COMMAND = "deja statusline";

export function claudeSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");
}

export type SetupResult =
  | { status: "installed"; path: string; backup?: string }
  | { status: "already"; path: string }
  | { status: "conflict"; path: string; existing: unknown }
  | { status: "invalid"; path: string; error: string };

export function installStatusline(path: string, force = false): SetupResult {
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { status: "invalid", path, error: "settings file is not a JSON object" };
      }
      settings = parsed as Record<string, unknown>;
    } catch (err) {
      return { status: "invalid", path, error: (err as Error).message };
    }
  }
  const existing = settings.statusLine as { command?: unknown } | undefined;
  if (existing && existing.command === STATUSLINE_COMMAND) return { status: "already", path };
  if (existing && !force) return { status: "conflict", path, existing };

  let backup: string | undefined;
  if (existsSync(path)) {
    backup = `${path}.deja-backup`;
    copyFileSync(path, backup);
  }
  settings.statusLine = { type: "command", command: STATUSLINE_COMMAND };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return { status: "installed", path, backup };
}

export function setupCommand(args: ParsedArgs): number {
  const what = args.positionals[0];
  if (what !== "statusline") {
    process.stderr.write("usage: deja setup statusline [--force]\n");
    return 2;
  }
  const r = installStatusline(claudeSettingsPath(), args.flags.force === true);
  switch (r.status) {
    case "installed":
      process.stdout.write(`✓ added deja's status line to ${r.path}${r.backup ? ` (backup: ${r.backup})` : ""}\n`);
      process.stdout.write("  it needs `deja` on your PATH: npm i -g dejactx\n");
      return 0;
    case "already":
      process.stdout.write(`✓ deja's status line is already set in ${r.path}\n`);
      return 0;
    case "conflict":
      process.stderr.write(`! ${r.path} already has a status line: ${JSON.stringify(r.existing)}\n  re-run with --force to replace it (a backup is kept)\n`);
      return 1;
    case "invalid":
      process.stderr.write(`✗ could not read ${r.path}: ${r.error}\n`);
      return 1;
  }
}
