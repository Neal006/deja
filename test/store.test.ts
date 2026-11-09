import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/decay/store.js";

const tmp = () => join(mkdtempSync(join(tmpdir(), "deja-store-")), "state.json");

describe("StateStore", () => {
  it("creates fresh state on first access", () => {
    const s = new StateStore();
    expect(s.get("a")).toEqual({ rent: 0, evicted: [] });
    expect(s.size).toBe(1);
  });

  it("returns the same object for the same key", () => {
    const s = new StateStore();
    s.get("a").rent = 5;
    expect(s.get("a").rent).toBe(5);
  });

  it("persists and reloads", () => {
    const path = tmp();
    const a = new StateStore(path);
    Object.assign(a.get("k"), { rent: 3, lastSeen: 10, evicted: ["toolu_1"] });
    a.save();
    expect(new StateStore(path).peek("k")).toEqual({ rent: 3, lastSeen: 10, evicted: ["toolu_1"] });
  });

  it("survives a corrupt file", () => {
    const path = tmp();
    writeFileSync(path, "{not json");
    expect(new StateStore(path).size).toBe(0);
  });

  it("ignores malformed entries", () => {
    const path = tmp();
    writeFileSync(path, JSON.stringify({ good: { rent: 0, evicted: [] }, bad: { rent: "x" } }));
    const s = new StateStore(path);
    expect(s.peek("good")).toBeDefined();
    expect(s.peek("bad")).toBeUndefined();
  });

  it("prunes the least recently seen conversations", () => {
    const s = new StateStore(undefined, 2);
    s.get("old").lastSeen = 1;
    s.get("mid").lastSeen = 2;
    s.get("new").lastSeen = 3;
    s.prune();
    expect(s.peek("old")).toBeUndefined();
    expect(s.size).toBe(2);
  });

  it("is a no-op to save without a path", () => {
    expect(() => new StateStore().save()).not.toThrow();
  });
});
