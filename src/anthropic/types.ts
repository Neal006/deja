/**
 * The subset of the Anthropic Messages API request shape that deja reads.
 * Everything else is passed through untouched, so these types are
 * deliberately loose.
 */

export interface TextBlock {
  type: "text";
  text: string;
  [k: string]: unknown;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: string | Array<TextBlock | { type: string; [k: string]: unknown }>;
  is_error?: boolean;
  [k: string]: unknown;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | { type: string; [k: string]: unknown };

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
  [k: string]: unknown;
}

export interface MessagesRequest {
  model?: string;
  system?: string | TextBlock[];
  messages: Message[];
  [k: string]: unknown;
}

export function isMessagesRequest(body: unknown): body is MessagesRequest {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { messages?: unknown }).messages)
  );
}
