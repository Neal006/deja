import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { DecayConfig } from "../decay/policy.js";
import type { Strategy } from "./replay.js";
import { simulate, type SessionStat } from "./simulate.js";
import { readTranscript } from "./transcript.js";
import type { Job } from "./worker.js";

export interface PoolOptions {
  strategies: readonly Strategy[];
  decay?: DecayConfig;
  /** Worker threads to use; 1 runs in-process. Defaults to CPUs - 1. */
  jobs?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Path of the compiled worker, if we are running from built output. */
function workerPath(): string | undefined {
  const p = fileURLToPath(new URL("./worker.js", import.meta.url));
  return existsSync(p) ? p : undefined;
}

function serial(paths: string[], opts: PoolOptions): SessionStat[] {
  const out: SessionStat[] = [];
  paths.forEach((path, i) => {
    try {
      out.push(simulate(readTranscript(path), { strategies: opts.strategies, decay: opts.decay }));
    } catch {
      // One unreadable transcript should not sink the whole audit.
    }
    opts.onProgress?.(i + 1, paths.length);
  });
  return out;
}

/**
 * Simulate many transcripts, in parallel when possible. Sessions are
 * independent, so this scales with cores. Results keep input order.
 */
export async function simulateMany(paths: string[], opts: PoolOptions): Promise<SessionStat[]> {
  const jobs = Math.max(1, Math.min(opts.jobs ?? Math.max(1, availableParallelism() - 1), paths.length));
  const script = workerPath();
  if (jobs <= 1 || !script) return serial(paths, opts);

  const results: Array<SessionStat | undefined> = new Array(paths.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: jobs }, () =>
      new Promise<void>((resolve) => {
        const w = new Worker(script);
        const feed = () => {
          if (next >= paths.length) {
            void w.terminate().then(() => resolve());
            return;
          }
          const id = next++;
          const job: Job = { id, path: paths[id]!, strategies: opts.strategies, decay: opts.decay };
          w.postMessage(job);
        };
        w.on("message", (msg: { id: number; stat?: SessionStat }) => {
          results[msg.id] = msg.stat;
          opts.onProgress?.(++done, paths.length);
          feed();
        });
        w.on("error", () => {
          void w.terminate().then(() => resolve());
        });
        feed();
      }),
    ),
  );
  return results.filter((r): r is SessionStat => r !== undefined);
}
