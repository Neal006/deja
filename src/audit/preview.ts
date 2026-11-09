import { transformRequest } from "../anthropic/transform.js";
import type { ContentBlock, MessagesRequest, ToolResultBlock, ToolUseBlock } from "../anthropic/types.js";
import { decide, DEFAULT_DECAY, freshState, type DecayConfig } from "../decay/policy.js";
import type { Segment } from "./transcript.js";

/**
 * Show what deja would have sent at one request of a recorded session:
 * which tool results were rewritten, and how.
 */

export interface PreviewBlock {
  messageIndex: number;
  kind: "result" | "input";
  toolUseId: string;
  before: string;
  after: string;
}

export interface Preview {
  /** Index (among assistant turns) of the request shown. */
  request: number;
  totalRequests: number;
  evicted: number;
  blocks: PreviewBlock[];
  tokensBefore: number;
  tokensAfter: number;
}

function resultText(b: ToolResultBlock): string {
  const c = b.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.map((x) => (x.type === "text" ? String((x as { text?: unknown }).text ?? "") : "")).join("\n");
}

/** Indices of messages that are assistant turns, i.e. one request each. */
export function requestIndices(seg: Segment): number[] {
  const out: number[] = [];
  seg.messages.forEach((m, i) => {
    if (i > 0 && m.role === "assistant") out.push(i);
  });
  return out;
}

export function preview(seg: Segment, opts: { request?: number; cwd?: string; decay?: DecayConfig | false } = {}): Preview | undefined {
  const reqs = requestIndices(seg);
  if (reqs.length === 0) return undefined;
  const n = Math.min(Math.max(opts.request ?? reqs.length, 1), reqs.length);
  const system = opts.cwd ? `Working directory: ${opts.cwd}` : undefined;

  // Replay decay decisions in order up to the chosen request.
  const state = freshState();
  let evict = new Set<string>();
  for (let k = 0; k < n; k++) {
    const j = reqs[k]!;
    const body: MessagesRequest = { system, messages: seg.messages.slice(0, j) };
    if (opts.decay !== false) evict = decide(body, state, seg.times[j - 1] ?? seg.times[j] ?? 0, opts.decay ?? DEFAULT_DECAY).evict;
  }

  const j = reqs[n - 1]!;
  const body: MessagesRequest = { system, messages: seg.messages.slice(0, j) };
  const r = transformRequest(body, { evict });
  const blocks: PreviewBlock[] = [];
  r.body.messages.forEach((msg, i) => {
    const orig = body.messages[i]!;
    if (msg === orig || typeof msg.content === "string" || typeof orig.content === "string") return;
    const before = orig.content;
    msg.content.forEach((b: ContentBlock, k) => {
      const o = before[k]!;
      if (b === o) return;
      if (b.type === "tool_result") {
        blocks.push({ messageIndex: i, kind: "result", toolUseId: (b as ToolResultBlock).tool_use_id, before: resultText(o as ToolResultBlock), after: resultText(b as ToolResultBlock) });
      } else if (b.type === "tool_use") {
        blocks.push({
          messageIndex: i,
          kind: "input",
          toolUseId: (b as ToolUseBlock).id,
          before: JSON.stringify((o as ToolUseBlock).input, null, 2),
          after: JSON.stringify((b as ToolUseBlock).input, null, 2),
        });
      }
    });
  });
  return {
    request: n,
    totalRequests: reqs.length,
    evicted: evict.size,
    blocks,
    tokensBefore: r.stats.tokensBefore,
    tokensAfter: r.stats.tokensAfter,
  };
}
