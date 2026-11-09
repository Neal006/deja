/**
 * Minimal argument parser. deja has a handful of flags; pulling in a CLI
 * framework would cost more install time than the whole tool.
 *
 * Everything after a literal `--` is passed through verbatim in `rest`.
 */
export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
  rest: string[];
}

/** Flags that never take a value, so `--quiet claude` keeps `claude` as the command. */
export const BOOLEAN_FLAGS = new Set(["json", "quiet", "off", "uncached", "quick", "help", "version", "color", "decay", "openai", "offline"]);

export function parseArgs(argv: string[], booleans: ReadonlySet<string> = BOOLEAN_FLAGS): ParsedArgs {
  const out: ParsedArgs = { command: undefined, positionals: [], flags: {}, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      out.rest = argv.slice(i + 1);
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const name = a.slice(2);
      const next = argv[i + 1];
      if (name.startsWith("no-")) {
        out.flags[name.slice(3)] = false;
      } else if (!booleans.has(name) && next !== undefined && !next.startsWith("-")) {
        out.flags[name] = next;
        i++;
      } else {
        out.flags[name] = true;
      }
      continue;
    }
    if (a.startsWith("-") && a.length === 2) {
      out.flags[a.slice(1)] = true;
      continue;
    }
    if (out.command === undefined) out.command = a;
    else out.positionals.push(a);
  }
  return out;
}

export function flagString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

export function flagNumber(flags: ParsedArgs["flags"], name: string): number | undefined {
  const v = flagString(flags, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse durations like `30m`, `12h`, `7d`, `2w` into milliseconds. */
export function parseDuration(s: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*([smhdw])$/.exec(s.trim());
  if (!m) return undefined;
  const unit = { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7, w: 6.048e8 }[m[2] as "s" | "m" | "h" | "d" | "w"];
  return Number(m[1]) * unit;
}
