/**
 * The subset of the OpenAI Chat Completions request shape deja reads.
 * Used by many agents and gateways (OpenRouter, vLLM, Ollama, LiteLLM…).
 */

export interface ChatToolCall {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
  [k: string]: unknown;
}

export interface ChatTextPart {
  type: "text";
  text: string;
  [k: string]: unknown;
}

export type ChatContent = string | null | Array<ChatTextPart | { type: string; [k: string]: unknown }>;

export interface ChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: ChatContent;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  [k: string]: unknown;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  [k: string]: unknown;
}

export function isChatRequest(body: unknown): body is ChatRequest {
  if (typeof body !== "object" || body === null) return false;
  const msgs = (body as { messages?: unknown }).messages;
  if (!Array.isArray(msgs)) return false;
  // Anthropic requests never use the "tool" or "system" roles in messages.
  return msgs.some((m) => {
    const role = (m as { role?: unknown })?.role;
    return role === "tool" || role === "system" || role === "developer" || Array.isArray((m as { tool_calls?: unknown })?.tool_calls);
  });
}
