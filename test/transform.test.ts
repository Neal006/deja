import { describe, expect, it } from "vitest";
import { transformRequest } from "../src/anthropic/transform.js";
import { code, Conversation, numbered, resultText } from "./helpers/conversation.js";

describe("transformRequest", () => {
  it("leaves a conversation without repeats untouched", () => {
    const body = new Conversation()
      .user("hi")
      .tool("Read", { file_path: "/repo/a.ts" }, numbered(code(40, "a")))
      .tool("Read", { file_path: "/repo/b.ts" }, numbered(code(40, "b")))
      .build();
    const r = transformRequest(body);
    expect(r.changed).toBe(false);
    expect(r.body).toBe(body);
    expect(r.stats.toolResults).toBe(2);
  });

  it("compresses a re-read of the same file", () => {
    const file = numbered(code(60));
    const body = new Conversation()
      .tool("Read", { file_path: "/repo/src/a.ts" }, file)
      .tool("Read", { file_path: "/repo/src/a.ts" }, file)
      .build();
    const r = transformRequest(body);
    expect(r.changed).toBe(true);
    expect(resultText(r.body, 1)).toBe(file);
    expect(resultText(r.body, 3)).toContain("same as all of Read src/a.ts");
    expect(r.stats.compressed).toBe(1);
    expect(r.stats.tokensAfter).toBeLessThan(r.stats.tokensBefore);
  });

  it("keeps single changed lines literal on every re-read", () => {
    const file = numbered(code(60));
    const edited = numbered([...code(60).slice(0, 30), "// edit", ...code(60).slice(30)]);
    const body = new Conversation()
      .tool("Read", { file_path: "/repo/a.ts" }, file)
      .tool("Read", { file_path: "/repo/a.ts" }, edited)
      .tool("Read", { file_path: "/repo/a.ts" }, edited)
      .build();
    const out = transformRequest(body).body;
    const third = resultText(out, 5);
    // A one-line change is below the reference threshold, so it is shown
    // literally while both untouched halves point at the first read.
    expect(third).toBe(resultText(out, 3));
    expect(third).toContain("    31\t// edit");
    expect(third).toContain("⟨same as Read a.ts lines 31-60⟩");
  });

  it("points at the later read for a block that only exists there", () => {
    const base = code(60);
    const block = code(10, "inserted");
    const edited = numbered([...base.slice(0, 30), ...block, ...base.slice(30)]);
    const body = new Conversation()
      .tool("Read", { file_path: "/repo/a.ts" }, numbered(base))
      .tool("Read", { file_path: "/repo/a.ts" }, edited)
      .tool("Read", { file_path: "/repo/a.ts" }, edited)
      .build();
    const third = resultText(transformRequest(body).body, 5);
    expect(third).toContain("⟨same as Read a.ts (2nd time) lines 31-40⟩");
    expect(third).toContain("⟨same as Read a.ts lines 31-60⟩");
  });

  it("never mutates the input request", () => {
    const file = numbered(code(60));
    const body = new Conversation().tool("Read", { file_path: "/repo/a.ts" }, file).tool("Read", { file_path: "/repo/a.ts" }, file).build();
    const snapshot = JSON.stringify(body);
    transformRequest(body);
    expect(JSON.stringify(body)).toBe(snapshot);
  });

  it("produces an identical prefix when the conversation grows", () => {
    const file = numbered(code(60));
    const conv = new Conversation().tool("Read", { file_path: "/repo/a.ts" }, file).tool("Read", { file_path: "/repo/a.ts" }, file);
    const first = transformRequest(conv.build()).body;
    conv.tool("Bash", { command: "npm test" }, "ok").tool("Read", { file_path: "/repo/a.ts" }, file);
    const second = transformRequest(conv.build()).body;
    expect(JSON.stringify(second.messages.slice(0, 4))).toBe(JSON.stringify(first.messages));
  });

  it("matches a read against content the model wrote itself", () => {
    const content = code(50).join("\n");
    const body = new Conversation()
      .tool("Write", { file_path: "/repo/new.ts", content }, "File created successfully")
      .tool("Read", { file_path: "/repo/new.ts" }, numbered(code(50)))
      .build();
    const text = resultText(transformRequest(body).body, 3);
    expect(text).toContain("same as all of your Write new.ts");
  });

  it("does not compress error results", () => {
    const file = numbered(code(60));
    const body = new Conversation().tool("Read", { file_path: "/repo/a.ts" }, file).tool("Read", { file_path: "/repo/a.ts" }, file, true).build();
    expect(transformRequest(body).changed).toBe(false);
  });

  it("honours skipTools", () => {
    const file = numbered(code(60));
    const body = new Conversation().tool("Read", { file_path: "/repo/a.ts" }, file).tool("Read", { file_path: "/repo/a.ts" }, file).build();
    expect(transformRequest(body, { skipTools: ["Read"] }).changed).toBe(false);
  });

  it("handles array-form tool results with text blocks", () => {
    const file = numbered(code(60));
    const body = new Conversation()
      .tool("Read", { file_path: "/repo/a.ts" }, [{ type: "text", text: file }])
      .tool("Read", { file_path: "/repo/a.ts" }, [{ type: "text", text: file }, { type: "image", source: {} }])
      .build();
    const r = transformRequest(body);
    expect(r.changed).toBe(true);
    const blocks = (r.body.messages[3]!.content as Array<{ content: Array<{ type: string }> }>)[0]!.content;
    expect(blocks[1]!.type).toBe("image");
  });

  it("compresses a re-run of a test command down to the new lines", () => {
    const passing = Array.from({ length: 40 }, (_, i) => ` ✓ test/unit/module${i}.test.ts (12 tests) ${i + 3}ms`);
    const body = new Conversation()
      .tool("Bash", { command: "npm test" }, passing.join("\n"))
      .tool("Bash", { command: "npm test" }, [...passing, " ✗ test/unit/new.test.ts > breaks"].join("\n"))
      .build();
    const text = resultText(transformRequest(body).body, 3);
    expect(text).toContain("⟨40 lines same as all of Bash `npm test`⟩");
    expect(text).toContain("✗ test/unit/new.test.ts > breaks");
  });

  it("passes string-content messages through", () => {
    const body = new Conversation().user("hello").build();
    expect(transformRequest(body).body.messages[0]).toBe(body.messages[0]);
  });
});
