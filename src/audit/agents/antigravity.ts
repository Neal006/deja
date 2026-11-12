/**
 * Google Antigravity agent adapter.
 *
 * Antigravity stores conversation logs as JSONL at:
 *   ~/.gemini/antigravity/brain/<conversation-id>/.system_generated/logs/transcript.jsonl
 *
 * Step types:
 *   - USER_INPUT: user request
 *   - PLANNER_RESPONSE: model response containing optional `tool_calls: [...]`
 *   - GENERIC: tool execution result corresponding to a pending tool call
 *
 * When a PLANNER_RESPONSE contains multiple tool calls, subsequent GENERIC
 * lines contain the output for each tool call in sequential order. A FIFO queue
 * maintains exact 1:1 association between each tool_use and its tool_result.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { ContentBlock, Message, ToolResultBlock, ToolUseBlock } from "../../anthropic/types.js";
import type { Segment, Transcript } from "../transcript.js";
import type { AgentAdapter } from "./index.js";

interface StepEnvelope {
  step_index?: number;
  source?: "USER_EXPLICIT" | "MODEL" | "SYSTEM";
  type?: "USER_INPUT" | "PLANNER_RESPONSE" | "GENERIC" | string;
  status?: string;
  created_at?: string;
  content?: string;
  thinking?: string;
  tool_calls?: Array<{
    name: string;
    args?: Record<string, unknown>;
  }>;
  input_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
}

interface PendingCall {
  id: string;
  name: string;
}

export function parseAntigravityTranscript(text: string, path = "<memory>"): Transcript {
  const t: Transcript = { path, segments: [] };
  const messages: Message[] = [];
  const times: Array<number | undefined> = [];

  // Queue of tool calls waiting for their corresponding GENERIC output.
  let pendingCalls: PendingCall[] = [];

  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let step: StepEnvelope;
    try {
      step = JSON.parse(raw) as StepEnvelope;
    } catch {
      continue;
    }

    const ts = step.created_at ? Date.parse(step.created_at) : undefined;
    if (ts !== undefined && Number.isFinite(ts)) {
      t.start = t.start === undefined ? ts : Math.min(t.start, ts);
      t.end = t.end === undefined ? ts : Math.max(t.end, ts);
    }

    if (step.type === "USER_INPUT") {
      // Discard any unmatched pending calls from a previous interrupted turn
      pendingCalls = [];
      const content = step.content?.trim() ?? "";
      if (content) {
        messages.push({
          role: "user",
          content: [{ type: "text", text: content }],
        });
        times.push(ts);
      }
    } else if (step.type === "PLANNER_RESPONSE") {
      pendingCalls = [];
      const blocks: ContentBlock[] = [];
      if (step.tool_calls && Array.isArray(step.tool_calls)) {
        for (let idx = 0; idx < step.tool_calls.length; idx++) {
          const call = step.tool_calls[idx]!;
          const callId = `call_${step.step_index ?? 0}_${idx}`;
          pendingCalls.push({ id: callId, name: call.name });

          // Parse stringified args if necessary
          let parsedArgs = call.args ?? {};
          if (typeof parsedArgs === "object" && parsedArgs !== null) {
            const clean: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(parsedArgs)) {
              if (typeof v === "string" && v.startsWith('"') && v.endsWith('"')) {
                try {
                  clean[k] = JSON.parse(v);
                } catch {
                  clean[k] = v;
                }
              } else {
                clean[k] = v;
              }
            }
            parsedArgs = clean;
          }

          blocks.push({
            type: "tool_use",
            id: callId,
            name: call.name,
            input: parsedArgs,
          } as ToolUseBlock);
        }
      } else if (step.content) {
        blocks.push({ type: "text", text: step.content });
      }

      if (blocks.length > 0) {
        messages.push({
          role: "assistant",
          content: blocks,
        });
        times.push(ts);
      }
    } else if (step.type === "GENERIC") {
      const content = step.content ?? "";
      if (pendingCalls.length > 0 && content) {
        const nextCall = pendingCalls.shift()!;
        const block: ToolResultBlock = {
          type: "tool_result",
          tool_use_id: nextCall.id,
          content,
        };
        messages.push({
          role: "user",
          content: [block],
        });
        times.push(ts);
      }
    }
  }

  if (messages.length > 0) {
    const seg: Segment = { messages, times };
    t.segments.push(seg);
  }

  return t;
}

export const antigravityAdapter: AgentAdapter = {
  id: "antigravity",
  name: "Google Antigravity",
  extensions: [".jsonl"],

  defaultDir(env = process.env): string {
    const gemini = env.GEMINI_HOME || join(homedir(), ".gemini");
    return join(gemini, "antigravity", "brain");
  },

  parse(text: string, path = "<memory>"): Transcript {
    return parseAntigravityTranscript(text, path);
  },
};
