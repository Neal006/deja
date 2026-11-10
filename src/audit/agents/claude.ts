/**
 * Claude Code agent adapter.
 *
 * Claude Code writes JSONL transcripts under:
 *   ~/.claude/projects/<slug>/<session-id>.jsonl
 */

import { claudeProjectsDir } from "../discover.js";
import { parseTranscript } from "../transcript.js";
import type { AgentAdapter } from "./index.js";

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  name: "Claude Code",

  defaultDir(env = process.env): string {
    return claudeProjectsDir(env);
  },

  parse(text: string, path = "<memory>") {
    return parseTranscript(text, path);
  },
};
