/**
 * Codex agent adapter.
 *
 * Codex CLI stores rollout files under:
 *   ~/.codex/sessions/YYYY/MM/DD/<session-id>.jsonl
 *
 * Uses OpenAI-style prompt caching (no write premium: 1.0x write, 0.1x read).
 */

import { OPENAI_BILLING } from "../billing.js";
import { codexSessionsDir, parseCodexRollout } from "../codex.js";
import type { AgentAdapter } from "./index.js";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  name: "Codex",
  billing: OPENAI_BILLING,

  defaultDir(env = process.env): string {
    return codexSessionsDir(env);
  },

  parse(text: string, path = "<memory>") {
    return parseCodexRollout(text, path);
  },
};
