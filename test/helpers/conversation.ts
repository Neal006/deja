import type { ContentBlock, Message, MessagesRequest } from "../../src/anthropic/types.js";

/** Tiny builder for Messages API conversations used across tests. */
export class Conversation {
  private readonly messages: Message[] = [];
  private n = 0;

  constructor(private readonly system = "Working directory: /repo") {}

  user(text: string): this {
    this.messages.push({ role: "user", content: text });
    return this;
  }

  /** Append an assistant tool call and the user turn carrying its result. */
  tool(name: string, input: Record<string, unknown>, result: string | ContentBlock[], isError = false): this {
    const id = `toolu_${String(++this.n).padStart(4, "0")}`;
    this.messages.push({
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
    });
    this.messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: result, ...(isError ? { is_error: true } : {}) }],
    });
    return this;
  }

  build(): MessagesRequest {
    return {
      model: "claude-sonnet-4-5",
      system: this.system,
      messages: structuredClone(this.messages),
    };
  }
}

export function numbered(body: string[], start = 1): string {
  return body.map((b, i) => `${String(i + start).padStart(6)}\t${b}`).join("\n");
}

export function code(n: number, tag = "h"): string[] {
  return Array.from(
    { length: n },
    (_, i) => `  export async function ${tag}${i}(req: Request): Promise<Response> { return respond(req, ${i}); }`,
  );
}

export function resultText(body: MessagesRequest, index: number): string {
  const msg = body.messages[index]!;
  const block = (msg.content as ContentBlock[])[0] as { content: unknown };
  if (typeof block.content === "string") return block.content;
  return (block.content as Array<{ text?: string }>).map((b) => b.text ?? "").join("\n");
}
