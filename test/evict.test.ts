import { describe, expect, it } from "vitest";
import { transformRequest } from "../src/anthropic/transform.js";
import type { ContentBlock, ToolUseBlock } from "../src/anthropic/types.js";
import { code, Conversation, numbered, resultText } from "./helpers/conversation.js";

const testLog = Array.from({ length: 120 }, (_, i) => ` ✓ test/unit/module${i}.test.ts (12 tests) ${i}ms`).join("\n");

function toolUse(body: ReturnType<Conversation["build"]>, index: number): ToolUseBlock {
  return (body.messages[index]!.content as ContentBlock[])[0] as ToolUseBlock;
}

describe("eviction", () => {
  it("replaces an evicted result with a stub", () => {
    const body = new Conversation().tool("Bash", { command: "npm test" }, testLog).build();
    const r = transformRequest(body, { evict: new Set(["toolu_0001"]) });
    const text = resultText(r.body, 1);
    expect(text).toMatch(/^⟪deja: stale output of Bash `npm test` \(120 lines/);
    expect(r.stats.evictedResults).toBe(1);
    expect(r.stats.tokensAfter).toBeLessThan(r.stats.tokensBefore / 5);
  });

  it("keeps array form and cache markers when evicting block content", () => {
    const body = new Conversation()
      .tool("Bash", { command: "npm test" }, [{ type: "text", text: testLog, cache_control: { type: "ephemeral" } }])
      .build();
    const r = transformRequest(body, { evict: new Set(["toolu_0001"]) });
    const blocks = (r.body.messages[1]!.content as Array<{ content: Array<Record<string, unknown>> }>)[0]!.content;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("text");
    expect(String(blocks[0]!.text)).toMatch(/^⟪deja: stale/);
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("leaves results not in the set alone", () => {
    const body = new Conversation().tool("Bash", { command: "npm test" }, testLog).build();
    expect(transformRequest(body, { evict: new Set(["toolu_9999"]) }).changed).toBe(false);
  });

  it("keeps a tiny result instead of growing it into a stub", () => {
    const body = new Conversation().tool("Bash", { command: "pwd" }, "/repo").build();
    const r = transformRequest(body, { evict: new Set(["toolu_0001"]) });
    expect(r.changed).toBe(false);
    expect(r.stats.evictedResults).toBe(0);
  });

  it("stubs the body of an evicted Write but keeps its path", () => {
    const content = code(80).join("\n");
    const body = new Conversation().tool("Write", { file_path: "/repo/a.ts", content }, "ok").build();
    const r = transformRequest(body, { evict: new Set(["toolu_0001"]) });
    const use = toolUse(r.body, 0);
    expect(use.input.file_path).toBe("/repo/a.ts");
    expect(use.input.content).toMatch(/^⟪deja: stale: 80 lines you wrote with Write a\.ts/);
    expect(r.stats.evictedInputs).toBe(1);
  });

  it("stubs Edit strings and keeps their types", () => {
    const old_string = code(10).join("\n");
    const body = new Conversation()
      .tool("Edit", { file_path: "/repo/a.ts", old_string, new_string: "short", replace_all: false }, "ok")
      .build();
    const use = toolUse(transformRequest(body, { evict: new Set(["toolu_0001"]) }).body, 0);
    expect(typeof use.input.old_string).toBe("string");
    expect(use.input.old_string).not.toBe(old_string);
    expect(use.input.new_string).toBe("short");
    expect(use.input.replace_all).toBe(false);
  });

  it("does not stub inputs of non-file tools", () => {
    const body = new Conversation().tool("Bash", { command: `echo ${"x".repeat(400)}` }, "x").build();
    const r = transformRequest(body, { evict: new Set(["toolu_0001"]) });
    expect(toolUse(r.body, 0).input.command).toBe(`echo ${"x".repeat(400)}`);
  });

  it("never references evicted content from later results", () => {
    const file = numbered(code(60));
    const body = new Conversation()
      .tool("Read", { file_path: "/repo/a.ts" }, file)
      .tool("Read", { file_path: "/repo/a.ts" }, file)
      .build();
    const r = transformRequest(body, { evict: new Set(["toolu_0001"]) });
    expect(resultText(r.body, 1)).toMatch(/^⟪deja: stale/);
    // The second read must be shown in full: its only source is gone.
    expect(resultText(r.body, 3)).toBe(file);
  });

  it("does not let an evicted write serve as a dedup source", () => {
    const content = code(50).join("\n");
    const body = new Conversation()
      .tool("Write", { file_path: "/repo/n.ts", content }, "ok")
      .tool("Read", { file_path: "/repo/n.ts" }, numbered(code(50)))
      .build();
    const r = transformRequest(body, { evict: new Set(["toolu_0001"]) });
    expect(resultText(r.body, 3)).toBe(numbered(code(50)));
  });

  it("keeps the prefix before the earliest evicted message identical", () => {
    const conv = new Conversation()
      .tool("Bash", { command: "ls" }, testLog)
      .tool("Bash", { command: "npm test" }, testLog.replace(/ms/g, "s"))
      .tool("Bash", { command: "npm run build" }, testLog.replace(/✓/g, "+"));
    const plain = transformRequest(conv.build()).body;
    const evicted = transformRequest(conv.build(), { evict: new Set(["toolu_0003"]) }).body;
    expect(JSON.stringify(evicted.messages.slice(0, 4))).toBe(JSON.stringify(plain.messages.slice(0, 4)));
  });
});
