import { parentPort } from "node:worker_threads";
import type { DecayConfig } from "../decay/policy.js";
import type { BillingConfig } from "./billing.js";
import type { Strategy } from "./replay.js";
import { simulate } from "./simulate.js";
import { readCodexRollout } from "./codex.js";
import { readTranscript } from "./transcript.js";

/** Worker entry point: simulate one transcript per message. */
export interface Job {
  id: number;
  path: string;
  strategies: readonly Strategy[];
  decay?: DecayConfig;
  billing?: BillingConfig;
  format?: TranscriptFormat;
}

export type TranscriptFormat = "claude" | "codex";

export function readAny(path: string, format: TranscriptFormat = "claude") {
  return format === "codex" ? readCodexRollout(path) : readTranscript(path);
}

parentPort?.on("message", (job: Job) => {
  try {
    const stat = simulate(readAny(job.path, job.format), { strategies: job.strategies, decay: job.decay, billing: job.billing });
    parentPort!.postMessage({ id: job.id, stat });
  } catch (err) {
    parentPort!.postMessage({ id: job.id, error: (err as Error).message });
  }
});
