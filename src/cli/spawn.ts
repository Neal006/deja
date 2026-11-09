import { existsSync } from "node:fs";

/**
 * Cross-platform process launch arguments.
 *
 * On Windows, agent CLIs installed by npm are `.cmd` shims, which Node can
 * only start through a shell. With `shell: true` Node joins arguments with
 * plain spaces, so we must quote them ourselves for cmd.exe.
 */

/** Quote one argument for cmd.exe (MSVC argv rules plus metacharacters). */
export function quoteWindowsArg(arg: string): string {
  if (arg === "") return '""';
  if (!/[\s"&|<>^()%!,;=]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(backslashes * 2 + 1) + '"';
    } else {
      out += "\\".repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  out += "\\".repeat(backslashes * 2) + '"';
  return out;
}

/**
 * Find what a bare command name resolves to on Windows, using PATH and
 * PATHEXT the way cmd.exe does. Returns the full path, or undefined.
 */
export function resolveWindowsCommand(command: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean): string | undefined {
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const hasExt = exts.some((e) => command.toLowerCase().endsWith(e.toLowerCase()));
  const candidates = hasExt ? [command] : exts.map((e) => command + e.toLowerCase());
  const dirs = /[\\/]/.test(command) ? [""] : (env.PATH ?? env.Path ?? "").split(";").filter(Boolean);
  for (const dir of dirs) {
    for (const c of candidates) {
      const full = dir ? `${dir.replace(/[\\/]$/, "")}\\${c}` : c;
      if (exists(full)) return full;
    }
  }
  return undefined;
}

export interface Launch {
  command: string;
  args: string[];
  shell: boolean;
}

export function launchArgs(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): Launch {
  if (platform !== "win32") return { command, args, shell: false };
  const resolved = resolveWindowsCommand(command, env, exists);
  // Real executables are started directly: no shell, no quoting problems
  // (cmd.exe cannot even pass newlines through). Only script shims need it.
  if (resolved && /\.(exe|com)$/i.test(resolved)) return { command: resolved, args, shell: false };
  return { command: quoteWindowsArg(resolved ?? command), args: args.map(quoteWindowsArg), shell: true };
}
