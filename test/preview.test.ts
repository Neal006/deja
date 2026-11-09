import { describe, expect, it } from "vitest";
import { preview, requestIndices } from "../src/audit/preview.js";
import type { Segment } from "../src/audit/transcript.js";
import type { Message } from "../src/anthropic/types.js";
import { code, Conversation, numbered } from "./helpers/conversation.js";

function segment(rounds = 0): Segment {
  const file = numbered(code(60));
  const conv = new Conversation().user("go").tool("Read", { file_path: "/repo/a.ts" }, file).tool("Read", { file_path: "/repo/a.ts" }, file);
  for (let i = 0; i < rounds; i++) conv.tool("Bash", { command: `echo ${i}` }, "ok");
  const messages: Message[] = conv.build().messages;
  messages.push({ role: "assistant", content: [{ type: "text", text: "done" }] });
  return { messages, times: messages.map((_, i) => i * 1000) };
}

describe("requestIndices", () => {
  it("lists assistant turns after the first message", () => {
    expect(requestIndices(segment())).toEqual([1, 3, 5]);
  });
});

describe("preview", () => {
  it("shows the dedup rewrite at the last request", () => {
    const pv = preview(segment(), { cwd: "/repo", decay: false })!;
    expect(pv.request).toBe(3);
    expect(pv.totalRequests).toBe(3);
    expect(pv.blocks).toHaveLength(1);
    expect(pv.blocks[0]!.after).toContain("same as all of Read a.ts");
    expect(pv.tokensAfter).toBeLessThan(pv.tokensBefore);
  });

  it("shows nothing before the repeat happens", () => {
    expect(preview(segment(), { request: 2, decay: false })!.blocks).toEqual([]);
  });

  it("clamps the request number", () => {
    expect(preview(segment(), { request: 99, decay: false })!.request).toBe(3);
    expect(preview(segment(), { request: 0, decay: false })!.request).toBe(1);
  });

  it("includes decay evictions once output is stale", () => {
    const pv = preview(segment(8), { cwd: "/repo" })!;
    expect(pv.evicted).toBeGreaterThan(0);
    expect(pv.blocks.some((b) => b.after.startsWith("⟪deja: stale"))).toBe(true);
  });

  it("returns undefined without requests", () => {
    expect(preview({ messages: [{ role: "user", content: "x" }], times: [0] })).toBeUndefined();
  });
});
