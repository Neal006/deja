/**
 * Agent adapter registry.
 *
 * Each AI coding agent that deja supports gets its own adapter. An adapter
 * knows where the agent stores transcripts, how to parse them, and which
 * billing model to use.
 *
 * To add a new agent:
 *   1. Create src/audit/agents/<name>.ts implementing AgentAdapter.
 *   2. Import and register it here in ADAPTERS.
 *   3. Add tests under test/agents.test.ts (or test/agents/<name>.test.ts).
 */

import type { BillingConfig } from "../billing.js";
import type { Transcript } from "../transcript.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { clineAdapter } from "./cline.js";

export interface AgentAdapter {
  /** Short identifier used in --agent flag (lowercase, no spaces). */
  id: string;
  /** Display name used in reports. */
  name: string;
  /**
   * Default sessions directory for this agent.
   * Returns undefined if the agent stores sessions in a non-standard location
   * or if auto-discovery is not supported.
   */
  defaultDir(env?: NodeJS.ProcessEnv): string | undefined;
  /**
   * Parse one session file into a Transcript.
   * Must never throw: return a Transcript with no segments on parse error.
   */
  parse(text: string, path?: string): Transcript;
  /**
   * Billing model for this agent's API provider.
   * Undefined means use the default Anthropic billing model.
   */
  billing?: BillingConfig;
  /**
   * File extensions this agent's transcript files use.
   * Used by discoverTranscripts to filter files.
   * Default: [".jsonl"]
   */
  extensions?: string[];
  /**
   * Exact filename to match (e.g. "api_conversation_history.json").
   * When specified, only files with this exact name will be parsed.
   */
  exactFilename?: string;
}

/**
 * All registered adapters, indexed by id.
 * The order here determines the order they appear in --help and error messages.
 */
export const ADAPTERS: ReadonlyMap<string, AgentAdapter> = new Map(
  [claudeAdapter, codexAdapter, clineAdapter].map((a) => [a.id, a]),
);

/**
 * Look up an adapter by id. Returns undefined for unknown agents.
 */
export function getAdapter(id: string): AgentAdapter | undefined {
  return ADAPTERS.get(id.toLowerCase());
}

/**
 * A human-readable list of supported agent ids, for error messages.
 */
export function supportedAgents(): string {
  return [...ADAPTERS.keys()].join(", ");
}
