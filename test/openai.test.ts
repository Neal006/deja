import { describe, expect, it } from "vitest";
import { toAnthropic, transformChatRequest } from "../src/openai/adapter.js";
import { isChatRequest, type ChatMessage, type ChatRequest } from "../src/openai/types.js";
import { code, numbered } from "./helpers/conversation.js";

class Chat {
  readonly messages: ChatMessage[] = [{ role: "system", content: "You are a coding agent. Working directory: /repo" }];
  private n = 0;
  user(text: string): this {
    this.messages.push({ role: "user", content: text });
    return this;
  }
  tool(name: string, args: Record<string, unknown>, result: string): this {
    const id = `call_${++this.n}`;
    this.messages.push({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    this.messages.push({ role: "tool", tool_call_id: id, content: result });
    return this;
  }
  build(): ChatRequest {
    return { model: "gpt-5", messages: structuredClone(this.messages) };
  }
}

describe("isChatRequest", () => {
  it("recognises chat requests", () => {
    expect(isChatRequest(new Chat().user("hi").build())).toBe(true);
  });
  it("rejects anthropic requests", () => {
    expect(isChatRequest({ messages: [{ role: "user", content: "hi" }] })).toBe(false);
  });
  it("rejects junk", () => {
    expect(isChatRequest(null)).toBe(false);
    expect(isChatRequest({ messages: "x" })).toBe(false);
  });
});

describe("toAnthropic", () => {
  it("maps system, tool calls and tool results", () => {
    const m = toAnthropic(new Chat().user("go").tool("read_file", { path: "/repo/a.ts" }, "x").build());
    expect(m.body.system).toContain("Working directory: /repo");
    expect(m.body.messages.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m.origins[1]![0]).toEqual({ chat: 2, kind: "tool_use", call: 0 });
  });

  it("keeps unparseable arguments", () => {
    const req: ChatRequest = {
      messages: [{ role: "assistant", content: null, tool_calls: [{ id: "c", function: { name: "f", arguments: "{oops" } }] }],
    };
    const use = (toAnthropic(req).body.messages[0]!.content as Array<{ input: unknown }>)[0]!;
    expect(use.input).toEqual({ arguments: "{oops" });
  });
});

describe("transformChatRequest", () => {
  it("dedups a re-read in OpenAI format", () => {
    const file = numbered(code(60));
    const req = new Chat().user("go").tool("read_file", { path: "/repo/a.ts" }, file).tool("read_file", { path: "/repo/a.ts" }, file).build();
    const r = transformChatRequest(req);
    expect(r.changed).toBe(true);
    expect(r.body.messages[3]!.content).toBe(file);
    expect(r.body.messages[5]!.content).toContain("same as all of read_file a.ts");
    // Untouched messages are the same objects.
    expect(r.body.messages[3]).toBe(req.messages[3]);
  });

  it("stubs an evicted write's arguments and keeps them valid JSON", () => {
    const content = code(40).join("\n");
    const req = new Chat().tool("write_file", { path: "/repo/n.ts", content }, "ok").build();
    const r = transformChatRequest(req, { evict: new Set(["call_1"]) });
    const args = JSON.parse(r.body.messages[1]!.tool_calls![0]!.function.arguments) as { path: string; content: string };
    expect(args.path).toBe("/repo/n.ts");
    expect(args.content).toMatch(/^⟪deja: stale/);
    expect(req.messages[1]!.tool_calls![0]!.function.arguments).toContain("export async function");
  });

  it("returns the request itself when nothing changes", () => {
    const req = new Chat().user("hi").build();
    expect(transformChatRequest(req).body).toBe(req);
  });

  it("handles array content in tool messages", () => {
    const file = numbered(code(60));
    const req = new Chat().tool("read_file", { path: "/repo/a.ts" }, file).build();
    req.messages.push({ role: "assistant", content: null, tool_calls: [{ id: "call_9", function: { name: "read_file", arguments: '{"path":"/repo/a.ts"}' } }] });
    req.messages.push({ role: "tool", tool_call_id: "call_9", content: [{ type: "text", text: file }] });
    const r = transformChatRequest(req);
    expect(String(r.body.messages[4]!.content)).toContain("same as all of read_file a.ts");
  });
});
