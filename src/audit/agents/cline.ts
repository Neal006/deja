/**
 * Cline agent adapter.
 *
 * Cline (VS Code extension) stores full task histories under:
 *   VS Code globalStorage:
 *   - macOS: ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/
 *   - Linux: ~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/
 *   - Windows: %APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/
 *
 * Each task folder contains:
 *   - `api_conversation_history.json`: The exact raw array of Anthropic Messages
 *     [{ role: "user" | "assistant", content: ... }] sent to the model.
 *   - `ui_messages.json`: Presentation-layer UI bubbles (ignored by deja).
 *
 * Discovery:
 *   Only `api_conversation_history.json` files are discovered and parsed.
 *   All metadata and UI files (`ui_messages.json`, task settings) are ignored.
 *
 * Timestamp Limitations:
 *   Cline's `api_conversation_history.json` does not record per-turn timestamps.
 *   Consequently:
 *   - Real-world idle-time TTL cache expiration (e.g. 5-minute cache drop) cannot
 *     be evaluated from the file alone; turns within a task are replayed consecutively.
 *   - Prefix matching, LZ77 dedup back-references, turn-based staleness decay, and
 *     compaction headroom modeling function normally and accurately.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "../../anthropic/types.js";
import type { Segment, Transcript } from "../transcript.js";
import type { AgentAdapter } from "./index.js";

export function parseClineHistory(text: string, path = "<memory>"): Transcript {
  const t: Transcript = { path, segments: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return t;
  }

  if (!Array.isArray(raw)) return t;

  const messages: Message[] = [];
  const times: Array<number | undefined> = [];

  for (const item of raw) {
    if (typeof item === "object" && item !== null && "role" in item && "content" in item) {
      messages.push(item as Message);
      times.push(undefined);
    }
  }

  if (messages.length > 0) {
    const seg: Segment = { messages, times };
    t.segments.push(seg);
  }

  return t;
}

export const clineAdapter: AgentAdapter = {
  id: "cline",
  name: "Cline",
  exactFilename: "api_conversation_history.json",

  defaultDir(env = process.env): string | undefined {
    if (env.CLINE_DIR) return env.CLINE_DIR;
    let base: string;
    if (process.platform === "win32") {
      base = env.APPDATA ? join(env.APPDATA, "Code", "User") : join(homedir(), "AppData", "Roaming", "Code", "User");
    } else if (process.platform === "darwin") {
      base = join(homedir(), "Library", "Application Support", "Code", "User");
    } else {
      base = join(homedir(), ".config", "Code", "User");
    }
    return join(base, "globalStorage", "saoudrizwan.claude-dev", "tasks");
  },

  parse(text: string, path = "<memory>"): Transcript {
    return parseClineHistory(text, path);
  },
};
