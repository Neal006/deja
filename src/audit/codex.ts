import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "../anthropic/types.js";
import { responsesToAnthropic, type ResponseItem } from "../openai/responses.js";
import type { Segment, Transcript } from "./transcript.js";

/**
 * Codex CLI history ("rollout" files under ~/.codex/sessions/YYYY/MM/DD).
 *
 * Each line is an envelope `{ timestamp, type, payload }`:
 *  - `session_meta`: payload.cwd (and id, cli_version, …)
 *  - `turn_context`: payload.model (and cwd, policies)
 *  - `response_item`: payload is an OpenAI Responses API item (message,
 *    function_call, function_call_output, custom_tool_call, reasoning, …)
 *  - `compacted`: the conversation was compacted; a new segment starts
 *  - `event_msg`: UI events and token counts (ignored here)
 *
 * The items of each segment are mapped onto the engine's message shape with
 * the same adapter the proxy uses for the Responses API.
 */

export function codexSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
}

interface Envelope {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

/** Response item types that carry conversation content. */
const CONTENT_ITEMS = new Set(["message", "function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output"]);

export function parseCodexRollout(text: string, path = "<memory>"): Transcript {
  const t: Transcript = { path, segments: [] };
  let items: ResponseItem[] = [];
  let itemTimes: Array<number | undefined> = [];
  const models = new Map<string, number>();

  const close = (compacted: boolean) => {
    if (items.length > 0) {
      const mapped = responsesToAnthropic({ input: items });
      // Each mapped message takes the time of its first underlying item.
      const times = mapped.origins.map((o) => itemTimes[o[0]!.item]);
      const segment: Segment = { messages: mapped.body.messages as Message[], times };
      if (compacted) segment.compacted = true;
      if (segment.messages.length > 0) t.segments.push(segment);
    }
    items = [];
    itemTimes = [];
  };

  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let line: Envelope;
    try {
      line = JSON.parse(raw) as Envelope;
    } catch {
      continue;
    }
    const ts = line.timestamp ? Date.parse(line.timestamp) : Number.NaN;
    const time = Number.isFinite(ts) ? ts : undefined;
    if (time !== undefined) {
      t.start = t.start === undefined ? time : Math.min(t.start, time);
      t.end = t.end === undefined ? time : Math.max(t.end, time);
    }
    const p = line.payload ?? {};
    switch (line.type) {
      case "session_meta":
        if (typeof p.cwd === "string") t.cwd ??= p.cwd;
        if (typeof p.id === "string") t.sessionId ??= p.id;
        break;
      case "turn_context":
        if (typeof p.cwd === "string") t.cwd ??= p.cwd;
        if (typeof p.model === "string") models.set(p.model, (models.get(p.model) ?? 0) + 1);
        break;
      case "compacted":
        close(true);
        break;
      case "response_item":
        if (typeof p.type === "string" && CONTENT_ITEMS.has(p.type)) {
          items.push(p as ResponseItem);
          itemTimes.push(time);
        }
        break;
      default:
        break;
    }
  }
  close(false);

  let best = 0;
  for (const [m, n] of models) {
    if (n > best) {
      best = n;
      t.model = m;
    }
  }
  return t;
}

export function readCodexRollout(path: string): Transcript {
  return parseCodexRollout(readFileSync(path, "utf8"), path);
}
