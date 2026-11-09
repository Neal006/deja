import { describe, expect, it } from "vitest";
import { IncrementalCache, IncrementalTransformer } from "../src/anthropic/incremental.js";
import { transformRequest } from "../src/anthropic/transform.js";
import { code, Conversation, numbered } from "./helpers/conversation.js";

function growing(steps: number) {
  const conv = new Conversation();
  const bodies = [];
  const file = code(60);
  for (let i = 0; i < steps; i++) {
    const edited = [...file.slice(0, i * 3), `// edit ${i}`, ...file.slice(i * 3)];
    conv.tool("Read", { file_path: "/repo/a.ts" }, numbered(edited));
    if (i % 2 === 0) conv.tool("Bash", { command: "npm test" }, Array.from({ length: 30 }, (_, k) => `PASS suite ${k} (${k}ms) ok`).join("\n"));
    bodies.push(conv.build());
  }
  return bodies;
}

describe("IncrementalTransformer", () => {
  it("matches a full transform at every step of a growing conversation", () => {
    const inc = new IncrementalTransformer();
    for (const body of growing(8)) {
      const a = inc.transform(body);
      const b = transformRequest(body);
      expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
      expect(a.stats).toEqual(b.stats);
      expect(a.savedByMessage).toEqual(b.savedByMessage);
    }
    expect(inc.counters).toEqual({ incremental: 7, rebuilt: 1 });
  });

  it("rebuilds when the eviction set changes", () => {
    const inc = new IncrementalTransformer();
    const [b1, b2] = growing(2);
    inc.transform(b1!);
    const r = inc.transform(b2!, { evict: new Set(["toolu_0001"]) });
    expect(JSON.stringify(r.body)).toBe(JSON.stringify(transformRequest(b2!, { evict: new Set(["toolu_0001"]) }).body));
    expect(inc.counters.rebuilt).toBe(2);
  });

  it("rebuilds when the client rewrote history", () => {
    const inc = new IncrementalTransformer();
    const [b1, b2] = growing(2);
    inc.transform(b1!);
    const edited = structuredClone(b2!);
    (edited.messages[1]!.content as Array<{ content: string }>)[0]!.content = "cleared by client";
    const r = inc.transform(edited);
    expect(JSON.stringify(r.body)).toBe(JSON.stringify(transformRequest(edited).body));
    expect(inc.counters.rebuilt).toBe(2);
  });

  it("rebuilds when the conversation got shorter", () => {
    const inc = new IncrementalTransformer();
    const bodies = growing(3);
    inc.transform(bodies[2]!);
    inc.transform(bodies[0]!);
    expect(inc.counters.rebuilt).toBe(2);
  });

  it("does not let returned arrays alias internal state", () => {
    const inc = new IncrementalTransformer();
    const [b1, b2] = growing(2);
    const r1 = inc.transform(b1!);
    const n = r1.savedByMessage.length;
    inc.transform(b2!);
    expect(r1.savedByMessage).toHaveLength(n);
  });
});

describe("IncrementalCache", () => {
  it("returns the same transformer per key", () => {
    const c = new IncrementalCache();
    expect(c.get("a")).toBe(c.get("a"));
  });

  it("evicts the least recently used key", () => {
    const c = new IncrementalCache(2);
    const a = c.get("a");
    c.get("b");
    c.get("a");
    c.get("c");
    expect(c.size).toBe(2);
    expect(c.get("a")).toBe(a);
    expect(c.size).toBe(2);
  });
});
