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

export interface Launch {
  command: string;
  args: string[];
  shell: boolean;
}

export function launchArgs(command: string, args: string[], platform: NodeJS.Platform = process.platform): Launch {
  if (platform !== "win32") return { command, args, shell: false };
  return { command: quoteWindowsArg(command), args: args.map(quoteWindowsArg), shell: true };
}
