import { describe, expect, it } from "vitest";
import { cacheTtlMs, takeInventory } from "../src/decay/inventory.js";
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
    expect(inv.items.map((i) => [i.id, i.kind, i.age])).toEqual([
      ["toolu_0001", "result", 2],
      ["toolu_0003", "result", 0],
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
