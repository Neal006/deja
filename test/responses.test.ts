import { describe, expect, it } from "vitest";
import {
  isResponsesRequest,
  responsesToAnthropic,
  transformResponsesRequest,
  type ResponseItem,
  type ResponsesRequest,
} from "../src/openai/responses.js";
import { code, numbered } from "./helpers/conversation.js";

class Session {
  readonly input: ResponseItem[] = [{ type: "message", role: "developer", content: [{ type: "input_text", text: "be terse" }] }];
  private n = 0;
  user(text: string): this {
    this.input.push({ type: "message", role: "user", content: [{ type: "input_text", text }] });
    return this;
  }
  call(name: string, args: Record<string, unknown>, output: string): this {
    const call_id = `call_${++this.n}`;
    this.input.push({ type: "function_call", call_id, name, arguments: JSON.stringify(args) });
    this.input.push({ type: "function_call_output", call_id, output });
    return this;
  }
  patch(patch: string): this {
    const call_id = `call_${++this.n}`;
    this.input.push({ type: "custom_tool_call", call_id, name: "apply_patch", input: patch });
    this.input.push({ type: "custom_tool_call_output", call_id, output: "Done" });
    return this;
  }
  build(): ResponsesRequest {
    return { model: "gpt-5-codex", instructions: "Working directory: /repo", input: structuredClone(this.input) };
  }
}

describe("isResponsesRequest", () => {
  it("accepts string and array input", () => {
    expect(isResponsesRequest({ input: "hi" })).toBe(true);
    expect(isResponsesRequest({ input: [] })).toBe(true);
  });
  it("rejects other bodies", () => {
    expect(isResponsesRequest({ messages: [] })).toBe(false);
    expect(isResponsesRequest(null)).toBe(false);
  });
});

describe("responsesToAnthropic", () => {
  it("maps items onto the engine shape", () => {
    const m = responsesToAnthropic(new Session().user("go").call("shell", { command: ["cat", "a.ts"] }, "x").build());
    expect(m.body.system).toBe("Working directory: /repo");
    expect(m.body.messages.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m.origins[1]).toEqual([{ item: 2, kind: "call" }]);
  });

  it("treats role-only items as messages", () => {
    const m = responsesToAnthropic({ input: [{ role: "user", content: "hello" }] });
    expect(m.body.messages).toHaveLength(1);
  });
});

describe("transformResponsesRequest", () => {
  it("dedups repeated function call output", () => {
    const file = numbered(code(60));
    const req = new Session().user("go").call("read_file", { path: "/repo/a.ts" }, file).call("read_file", { path: "/repo/a.ts" }, file).build();
    const r = transformResponsesRequest(req);
    const input = r.body.input as ResponseItem[];
    expect(r.changed).toBe(true);
    expect(input[3]).toBe((req.input as ResponseItem[])[3]);
    expect(String(input[5]!.output)).toContain("same as all of read_file a.ts");
  });

  it("stubs an evicted custom tool call input", () => {
    const patch = ["*** Begin Patch", "*** Add File: a.ts", ...code(40).map((l) => `+${l}`), "*** End Patch"].join("\n");
    const req = new Session().patch(patch).build();
    // apply_patch is a file-writing tool, so its input body can decay.
    const r = transformResponsesRequest(req, { evict: new Set(["call_1"]) });
    const item = (r.body.input as ResponseItem[])[1]!;
    expect(item.input).toMatch(/^⟪deja: stale/);
    expect((req.input as ResponseItem[])[1]!.input).toBe(patch);
  });

  it("returns string input untouched", () => {
    const req = { input: "hello" };
    expect(transformResponsesRequest(req).body).toBe(req);
  });
});
