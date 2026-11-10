import { readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import type { DecayConfig } from "../decay/policy.js";
import { getAdapter, supportedAgents } from "./agents/index.js";
import type { BillingConfig } from "./billing.js";
import type { Strategy } from "./replay.js";
import { simulate } from "./simulate.js";

/** Worker entry point: simulate one transcript per message. */
export interface Job {
  id: number;
  path: string;
  strategies: readonly Strategy[];
  decay?: DecayConfig;
  billing?: BillingConfig;
  agent?: string;
  /** @deprecated Use `agent` instead. Kept for backward compatibility. */
  format?: TranscriptFormat;
}

export type TranscriptFormat = "claude" | "codex";

export function readAny(path: string, agentOrFormat: string = "claude") {
  const adapter = getAdapter(agentOrFormat);
  if (!adapter) {
    throw new Error(`Unknown agent: ${agentOrFormat}. Supported: ${supportedAgents()}`);
  }
  const text = readFileSync(path, "utf8");
  return adapter.parse(text, path);
}

parentPort?.on("message", (job: Job) => {
  try {
    const target = job.agent ?? job.format ?? "claude";
    const stat = simulate(readAny(job.path, target), { strategies: job.strategies, decay: job.decay, billing: job.billing });
    parentPort!.postMessage({ id: job.id, stat });
  } catch (err) {
    parentPort!.postMessage({ id: job.id, error: (err as Error).message });
  }
});
