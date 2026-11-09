import { describe, expect, it } from "vitest";
import { cacheTtlMs, inputPath, takeInventory } from "../src/decay/inventory.js";
import { code, Conversation } from "./helpers/conversation.js";

const log = Array.from({ length: 100 }, (_, i) => `PASS test/suite-${i}.test.ts (${i} ms) all good here`).join("\n");

describe("takeInventory", () => {
  it("lists large results with their age", () => {
    const body = new Conversation()
      .tool("Bash", { command: "npm test" }, log)
      .tool("Bash", { command: "ls" }, "a")
      .tool("Bash", { command: "npm test" }, log)
      .build();
    const inv = takeInventory(body);
    expect(inv.items.map((i) => [i.id, i.kind, i.tool, i.age])).toEqual([
      ["toolu_0001", "result", "Bash", 2],
      ["toolu_0003", "result", "Bash", 0],
    ]);
    expect(inv.key).toBe("toolu_0001");
    expect(inv.messageTokens).toHaveLength(6);
  });

  it("lists large write inputs", () => {
    const body = new Conversation().tool("Write", { file_path: "/a", content: code(40).join("\n") }, "ok").build();
    const [item] = takeInventory(body).items;
    expect(item).toMatchObject({ id: "toolu_0001", kind: "input", messageIndex: 0, age: 0 });
    expect(item!.saving).toBeGreaterThan(500);
  });

  it("keeps a read young while its file is still being edited", () => {
    const body = new Conversation()
      .tool("Read", { file_path: "/repo/a.ts" }, log)
      .tool("Bash", { command: "ls" }, "x")
      .tool("Bash", { command: "pwd" }, "x")
      .tool("Edit", { file_path: "/repo/a.ts", old_string: "a", new_string: "b" }, "ok")
      .tool("Bash", { command: "date" }, "x")
      .build();
    const read = takeInventory(body).items.find((i) => i.id === "toolu_0001")!;
    // Created 4 requests ago, but touched by the Edit only 1 request ago.
    expect(read.age).toBe(1);
  });

  it("does not let a later read refresh an earlier one", () => {
    const body = new Conversation()
      .tool("Read", { file_path: "/repo/a.ts" }, log)
      .tool("Read", { file_path: "/repo/a.ts" }, "short")
      .tool("Bash", { command: "date" }, "x")
      .build();
    expect(takeInventory(body).items.find((i) => i.id === "toolu_0001")!.age).toBe(2);
  });

  it("does not let a different file refresh an item", () => {
    const body = new Conversation()
      .tool("Read", { file_path: "/repo/a.ts" }, log)
      .tool("Edit", { file_path: "/repo/b.ts", old_string: "a", new_string: "b" }, "ok")
      .tool("Bash", { command: "date" }, "x")
      .build();
    expect(takeInventory(body).items.find((i) => i.id === "toolu_0001")!.age).toBe(2);
  });

  it("skips error results", () => {
    const body = new Conversation().tool("Bash", { command: "x" }, log, true).build();
    expect(takeInventory(body).items).toEqual([]);
  });

  it("has no key without tool calls", () => {
    expect(takeInventory(new Conversation().user("hi").build()).key).toBeUndefined();
  });
});

describe("cacheTtlMs", () => {
  it("defaults to five minutes", () => {
    expect(cacheTtlMs(new Conversation().user("hi").build())).toBe(300_000);
  });
  it("detects one-hour caching", () => {
    const body = new Conversation().build();
    body.messages.push({ role: "user", content: [{ type: "text", text: "x", cache_control: { type: "ephemeral", ttl: "1h" } }] });
    expect(cacheTtlMs(body)).toBe(3_600_000);
  });
});

describe("inputPath", () => {
  it("finds the file a call is about", () => {
    expect(inputPath({ file_path: "/a" })).toBe("/a");
    expect(inputPath({ path: "/b", pattern: "x" })).toBe("/b");
    expect(inputPath({ command: "ls" })).toBeUndefined();
    expect(inputPath(undefined)).toBeUndefined();
  });
});
