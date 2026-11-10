import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where Claude Code keeps per-project transcripts. */
export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(base, "projects");
}

export interface DiscoverOptions {
  /** Only include files modified at or after this epoch-ms time. */
  since?: number;
  /** Only include files whose path contains this substring. */
  match?: string;
  /** Hard cap on the number of files, newest first. */
  limit?: number;
  /** Extensions to match (default: [".jsonl"]). */
  extensions?: string[];
}

export interface Found {
  path: string;
  mtime: number;
  size: number;
}

/** Recursively find `.jsonl` transcripts, newest first. Missing dirs yield nothing. */
export function discoverTranscripts(root: string, opts: DiscoverOptions = {}): Found[] {
  const out: Found[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p, depth + 1);
      } else if ((opts.extensions ?? [".jsonl"]).some((ext) => name.endsWith(ext))) {
        if (opts.since !== undefined && st.mtimeMs < opts.since) continue;
        if (opts.match && !p.includes(opts.match)) continue;
        out.push({ path: p, mtime: st.mtimeMs, size: st.size });
      }
    }
  };
  walk(root, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}
