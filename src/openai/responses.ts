import { transformRequest, type TransformOptions, type TransformResult } from "../anthropic/transform.js";
import type { ContentBlock, Message, MessagesRequest, ToolResultBlock, ToolUseBlock } from "../anthropic/types.js";

/**
 * OpenAI Responses API support (used by the Codex CLI and newer agents).
 *
 * The `input` array mixes messages, function calls and their outputs. As
 * with Chat Completions, we map it onto the engine's Anthropic shape, run
 * dedup/decay, and write changed text back onto a copy of the original
 * items, leaving untouched items as the very same objects.
 */

export interface ResponseItem {
  type?: string;
  role?: string;
  content?: unknown;
  call_id?: string;
  name?: string;
  arguments?: string;
  input?: string;
  output?: unknown;
  [k: string]: unknown;
}

export interface ResponsesRequest {
  model?: string;
  instructions?: string;
  input: string | ResponseItem[];
  [k: string]: unknown;
}

export function isResponsesRequest(body: unknown): body is ResponsesRequest {
  if (typeof body !== "object" || body === null) return false;
  const input = (body as { input?: unknown }).input;
  return typeof input === "string" || Array.isArray(input);
}

function itemText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter((p): p is { text: string } => typeof p === "object" && p !== null && typeof (p as { text?: unknown }).text === "string")
    .map((p) => p.text);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { arguments: raw };
  } catch {
    return { arguments: raw };
  }
}

type Kind = "text" | "call" | "custom_call" | "output";

export interface ResponsesMapped {
  body: MessagesRequest;
  origins: Array<Array<{ item: number; kind: Kind }>>;
}

export function responsesToAnthropic(req: ResponsesRequest): ResponsesMapped {
  const messages: Message[] = [];
  const origins: ResponsesMapped["origins"] = [];
  const items = typeof req.input === "string" ? [] : req.input;
  const push = (role: "user" | "assistant", block: ContentBlock, item: number, kind: Kind) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      (last.content as ContentBlock[]).push(block);
      origins[origins.length - 1]!.push({ item, kind });
    } else {
      messages.push({ role, content: [block] });
      origins.push([{ item, kind }]);
    }
  };
  items.forEach((it, i) => {
    const type = it.type ?? (it.role ? "message" : undefined);
    if (type === "message") {
      if (it.role === "system" || it.role === "developer") return;
      const text = itemText(it.content);
      if (text !== undefined) push(it.role === "assistant" ? "assistant" : "user", { type: "text", text }, i, "text");
    } else if (type === "function_call") {
      push("assistant", { type: "tool_use", id: it.call_id ?? `call_${i}`, name: it.name ?? "tool", input: parseArgs(it.arguments) } as ToolUseBlock, i, "call");
    } else if (type === "custom_tool_call") {
      push("assistant", { type: "tool_use", id: it.call_id ?? `call_${i}`, name: it.name ?? "tool", input: { input: it.input ?? "" } } as ToolUseBlock, i, "custom_call");
    } else if (type === "function_call_output" || type === "custom_tool_call_output") {
      push("user", { type: "tool_result", tool_use_id: it.call_id ?? `call_${i}`, content: itemText(it.output) ?? "" } as ToolResultBlock, i, "output");
    }
  });
  return { body: { model: req.model, system: req.instructions, messages }, origins };
}

export function responsesFromAnthropic(req: ResponsesRequest, mapped: ResponsesMapped, out: MessagesRequest): ResponsesRequest {
  if (typeof req.input === "string") return req;
  const replaced = new Map<number, ResponseItem>();
  out.messages.forEach((msg, i) => {
    const before = mapped.body.messages[i]!;
    if (msg === before || typeof msg.content === "string") return;
    const orig = before.content as ContentBlock[];
    msg.content.forEach((b, j) => {
      if (b === orig[j]) return;
      const { item, kind } = mapped.origins[i]![j]!;
      const copy = { ...(replaced.get(item) ?? (req.input as ResponseItem[])[item]!) };
      if (kind === "output") {
        const c = (b as ToolResultBlock).content;
        copy.output = typeof c === "string" ? c : itemText(c) ?? "";
      } else if (kind === "call") {
        copy.arguments = JSON.stringify((b as ToolUseBlock).input);
      } else if (kind === "custom_call") {
        copy.input = String((b as ToolUseBlock).input.input ?? "");
      }
      replaced.set(item, copy);
    });
  });
  if (replaced.size === 0) return req;
  return { ...req, input: req.input.map((it, i) => replaced.get(i) ?? it) };
}

export interface ResponsesTransformResult extends Omit<TransformResult, "body"> {
  body: ResponsesRequest;
  mapped: ResponsesMapped;
}

export function transformResponsesRequest(req: ResponsesRequest, options: TransformOptions = {}): ResponsesTransformResult {
  const mapped = responsesToAnthropic(req);
  const result = transformRequest(mapped.body, options);
  const body = result.changed ? responsesFromAnthropic(req, mapped, result.body) : req;
  return { ...result, body, changed: body !== req, mapped };
}
