import { transformRequest, type TransformOptions, type TransformResult } from "../anthropic/transform.js";
import type { ContentBlock, Message, MessagesRequest, TextBlock, ToolResultBlock, ToolUseBlock } from "../anthropic/types.js";
import type { ChatContent, ChatMessage, ChatRequest } from "./types.js";

/**
 * Run deja's engine on an OpenAI Chat Completions request.
 *
 * Chat messages are mapped onto the Anthropic shape the engine understands
 * (assistant tool_calls -> tool_use blocks, tool messages -> tool_result
 * blocks), transformed, and the rewritten text is mapped back onto a copy of
 * the original messages. Messages the engine did not change are returned as
 * the very same objects, so serialisation of the prefix stays identical.
 */

interface Origin {
  /** Index into the original chat messages. */
  chat: number;
  kind: "text" | "tool_use" | "tool_result";
  /** For tool_use: index into that message's tool_calls. */
  call?: number;
}

function text(content: ChatContent | undefined): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.filter((p) => p.type === "text").map((p) => String((p as { text?: unknown }).text ?? ""));
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return undefined;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { arguments: raw };
  } catch {
    return { arguments: raw };
  }
}

export interface Mapped {
  body: MessagesRequest;
  /** origins[i][j] = where block j of mapped message i came from. */
  origins: Origin[][];
}

export function toAnthropic(req: ChatRequest): Mapped {
  const system = req.messages
    .filter((m) => m.role === "system" || m.role === "developer")
    .map((m) => text(m.content) ?? "")
    .join("\n");
  const messages: Message[] = [];
  const origins: Origin[][] = [];

  const push = (role: "user" | "assistant", block: ContentBlock, origin: Origin) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      (last.content as ContentBlock[]).push(block);
      origins[origins.length - 1]!.push(origin);
    } else {
      messages.push({ role, content: [block] });
      origins.push([origin]);
    }
  };

  req.messages.forEach((m, chat) => {
    if (m.role === "system" || m.role === "developer") return;
    if (m.role === "tool") {
      const block: ToolResultBlock = { type: "tool_result", tool_use_id: m.tool_call_id ?? `call_${chat}`, content: text(m.content) ?? "" };
      push("user", block, { chat, kind: "tool_result" });
      return;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const t = text(m.content);
    if (t !== undefined) push(role, { type: "text", text: t } as TextBlock, { chat, kind: "text" });
    m.tool_calls?.forEach((c, call) => {
      const block: ToolUseBlock = { type: "tool_use", id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) };
      push("assistant", block, { chat, kind: "tool_use", call });
    });
  });
  return { body: { model: req.model, system, messages }, origins };
}

/** Apply a transformed Anthropic body back onto a copy of the chat request. */
export function fromAnthropic(req: ChatRequest, mapped: Mapped, out: MessagesRequest): ChatRequest {
  const replaced = new Map<number, ChatMessage>();
  const get = (i: number): ChatMessage => {
    let m = replaced.get(i);
    if (!m) {
      const orig = req.messages[i]!;
      m = { ...orig, ...(orig.tool_calls ? { tool_calls: orig.tool_calls.map((c) => ({ ...c, function: { ...c.function } })) } : {}) };
      replaced.set(i, m);
    }
    return m;
  };

  out.messages.forEach((msg, i) => {
    const before = mapped.body.messages[i];
    if (msg === before || typeof msg.content === "string") return;
    const blocks = msg.content;
    const original = before!.content as ContentBlock[];
    blocks.forEach((b, j) => {
      if (b === original[j]) return;
      const origin = mapped.origins[i]![j]!;
      const m = get(origin.chat);
      if (origin.kind === "tool_result") {
        const c = (b as ToolResultBlock).content;
        m.content = typeof c === "string" ? c : text(c as ChatContent) ?? "";
      } else if (origin.kind === "tool_use" && origin.call !== undefined) {
        m.tool_calls![origin.call]!.function.arguments = JSON.stringify((b as ToolUseBlock).input);
      }
    });
  });

  if (replaced.size === 0) return req;
  return { ...req, messages: req.messages.map((m, i) => replaced.get(i) ?? m) };
}

export interface ChatTransformResult extends Omit<TransformResult, "body"> {
  body: ChatRequest;
  mapped: Mapped;
}

export function transformChatRequest(req: ChatRequest, options: TransformOptions = {}): ChatTransformResult {
  const mapped = toAnthropic(req);
  const result = transformRequest(mapped.body, options);
  const body = result.changed ? fromAnthropic(req, mapped, result.body) : req;
  return { ...result, body, changed: body !== req, mapped };
}
