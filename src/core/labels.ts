/**
 * Turn a tool call into a short, unambiguous label the model can recognise,
 * e.g. `Read src/app.ts` or ``Bash `npm test` ``.
 */

const MAX_ARG = 64;

function clip(s: string, max = MAX_ARG): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function relativize(path: string, cwd: string | undefined): string {
  if (!cwd) return path;
  const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Map of well-known tool names (several agents) to the argument that identifies the call. */
const PATH_KEYS = ["file_path", "path", "filePath", "target_file", "absolute_path", "notebook_path"];
const COMMAND_KEYS = ["command", "cmd"];
const PATTERN_KEYS = ["pattern", "query", "regex"];

export function toolLabel(name: string, input: Record<string, unknown> | undefined, cwd?: string): string {
  const args = input ?? {};
  for (const k of COMMAND_KEYS) {
    const v = str(args[k]);
    if (v) return `${name} \`${clip(v)}\``;
  }
  for (const k of PATH_KEYS) {
    const v = str(args[k]);
    if (v) return `${name} ${clip(relativize(v, cwd))}`;
  }
  for (const k of PATTERN_KEYS) {
    const v = str(args[k]);
    if (v) return `${name} ${JSON.stringify(clip(v, 40))}`;
  }
  const url = str(args.url);
  if (url) return `${name} ${clip(url)}`;
  return `${name} result`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Hands out labels that stay unique within one conversation: the second time
 * the same file is read it becomes `Read a.ts (2nd time)`.
 */
export class LabelRegistry {
  private readonly counts = new Map<string, number>();

  next(base: string): string {
    const n = (this.counts.get(base) ?? 0) + 1;
    this.counts.set(base, n);
    return n === 1 ? base : `${base} (${ordinal(n)} time)`;
  }
}

/** Extract the working directory from a Claude Code style system prompt. */
export function findCwd(system: string): string | undefined {
  const m = /Working directory:\s*(\S+)/.exec(system) ?? /Primary working directory:\s*(\S+)/.exec(system);
  return m?.[1];
}

export { ordinal };
