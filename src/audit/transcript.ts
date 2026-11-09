import { readFileSync } from "node:fs";
import type { ContentBlock, Message } from "../anthropic/types.js";

/**
 * Reconstruct the API conversation(s) from a Claude Code transcript.
 *
 * Claude Code writes one JSON object per line. Assistant messages are split
 * across several lines (one per content block) that share `message.id`, and
 * tool results arrive as separate `user` lines. A `compact_boundary` system
 * line means the context was summarised: everything before it stops being
 * resent, so we start a new segment there.
 */

export interface Segment {
  messages: Message[];
  /** When each message was first seen (epoch ms), aligned with `messages`. */
  times: Array<number | undefined>;
  /** True when this segment ended because Claude Code compacted the context. */
  compacted?: boolean;
}

export interface Transcript {
  path: string;
  sessionId?: string;
  cwd?: string;
  /** The model that answered most often in this transcript. */
  model?: string;
  /** First and last timestamp seen, epoch ms. */
  start?: number;
  end?: number;
  segments: Segment[];
}

interface Line {
  type?: string;
  subtype?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: { id?: string; role?: string; model?: string; content?: unknown };
}

function blocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content.filter((b): b is ContentBlock => typeof b === "object" && b !== null && "type" in b);
  return [];
}

/**
 * Parse a transcript. Sidechain lines (a subagent's turns embedded in the
 * main session) are skipped, except when the whole file is a sidechain:
 * Claude Code writes each subagent's conversation to its own file, where
 * every line is marked as sidechain.
 */
export function parseTranscript(text: string, path = "<memory>"): Transcript {
  const main = parseLines(text, path, false);
  if (main.segments.length > 0 || !/"isSidechain"\s*:\s*true/.test(text)) return main;
  return parseLines(text, path, true);
}

function parseLines(text: string, path: string, includeSidechain: boolean): Transcript {
  const t: Transcript = { path, segments: [] };
  let messages: Message[] = [];
  let times: Array<number | undefined> = [];
  let lastAssistantId: string | undefined;
  const models = new Map<string, number>();

  const closeSegment = (compacted = false) => {
    if (messages.length > 0) t.segments.push(compacted ? { messages, times, compacted } : { messages, times });
    messages = [];
    times = [];
    lastAssistantId = undefined;
  };

  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    let ts: number | undefined;
    if (line.timestamp) {
      const parsed = Date.parse(line.timestamp);
      if (Number.isFinite(parsed)) {
        ts = parsed;
        t.start = t.start === undefined ? ts : Math.min(t.start, ts);
        t.end = t.end === undefined ? ts : Math.max(t.end, ts);
      }
    }
    t.sessionId ??= line.sessionId;
    t.cwd ??= line.cwd;

    if (line.type === "system" && line.subtype === "compact_boundary") {
      closeSegment(true);
      continue;
    }
    if (line.type !== "user" && line.type !== "assistant") continue;
    if (line.isSidechain && !includeSidechain) continue;
    const msg = line.message;
    if (!msg) continue;
    if (line.type === "assistant" && typeof msg.model === "string" && !msg.model.startsWith("<")) {
      models.set(msg.model, (models.get(msg.model) ?? 0) + 1);
    }
    const content = blocks(msg.content);
    if (content.length === 0) continue;

    const role = line.type === "assistant" ? "assistant" : "user";
    const prev = messages[messages.length - 1];
    if (role === "assistant" && prev?.role === "assistant" && msg.id !== undefined && msg.id === lastAssistantId) {
      (prev.content as ContentBlock[]).push(...content);
      continue;
    }
    if (role === "user" && prev?.role === "user") {
      (prev.content as ContentBlock[]).push(...content);
      continue;
    }
    messages.push({ role, content: [...content] });
    times.push(ts);
    if (role === "assistant") lastAssistantId = msg.id;
  }
  closeSegment();
  let best = 0;
  for (const [m, n] of models) {
    if (n > best) {
      best = n;
      t.model = m;
    }
  }
  return t;
}

export function readTranscript(path: string): Transcript {
  return parseTranscript(readFileSync(path, "utf8"), path);
}

/**
 * How many API requests each message is sent in. Every assistant message is
 * the response to one request that carried all messages before it.
 */
export function resendCounts(messages: Message[]): number[] {
  const counts = new Array<number>(messages.length).fill(0);
  let assistantsAfter = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    counts[i] = assistantsAfter;
    if (messages[i]!.role === "assistant") assistantsAfter++;
  }
  return counts;
}
