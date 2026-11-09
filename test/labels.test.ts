import { describe, expect, it } from "vitest";
import { findCwd, LabelRegistry, ordinal, relativize, toolLabel } from "../src/core/labels.js";

describe("toolLabel", () => {
  it("labels reads by relative path", () => {
    expect(toolLabel("Read", { file_path: "/repo/src/a.ts" }, "/repo")).toBe("Read src/a.ts");
  });
  it("labels bash by command", () => {
    expect(toolLabel("Bash", { command: "npm test", description: "x" })).toBe("Bash `npm test`");
  });
  it("collapses whitespace and clips long commands", () => {
    const label = toolLabel("Bash", { command: `echo ${"x".repeat(200)}\n` });
    expect(label.length).toBeLessThan(80);
    expect(label).toContain("…");
  });
  it("labels searches by pattern", () => {
    expect(toolLabel("Grep", { pattern: "TODO", path: undefined })).toBe('Grep "TODO"');
  });
  it("falls back to a generic label", () => {
    expect(toolLabel("mcp__x__y", {})).toBe("mcp__x__y result");
  });
  it("labels fetches by url", () => {
    expect(toolLabel("WebFetch", { url: "https://example.com/docs" })).toBe("WebFetch https://example.com/docs");
  });
});

describe("relativize", () => {
  it("keeps paths outside the cwd", () => {
    expect(relativize("/etc/hosts", "/repo")).toBe("/etc/hosts");
  });
  it("handles a trailing slash on cwd", () => {
    expect(relativize("/repo/a", "/repo/")).toBe("a");
  });
  it("handles Windows separators", () => {
    expect(relativize("C:\\repo\\src\\a.ts", "C:\\repo")).toBe("src\\a.ts");
  });
  it("does not strip sibling prefixes", () => {
    expect(relativize("/repository/a", "/repo")).toBe("/repository/a");
  });
});

describe("LabelRegistry", () => {
  it("numbers repeated labels", () => {
    const r = new LabelRegistry();
    expect(r.next("Read a")).toBe("Read a");
    expect(r.next("Read a")).toBe("Read a (2nd time)");
    expect(r.next("Read b")).toBe("Read b");
    expect(r.next("Read a")).toBe("Read a (3rd time)");
  });
});

describe("ordinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [112, "112th"],
  ])("%i -> %s", (n, s) => expect(ordinal(n)).toBe(s));
});

describe("findCwd", () => {
  it("finds the Claude Code working directory line", () => {
    expect(findCwd("blah\nWorking directory: /home/me/app\nmore")).toBe("/home/me/app");
  });
  it("finds the primary working directory variant", () => {
    expect(findCwd(" - Primary working directory: /x/y")).toBe("/x/y");
  });
  it("returns undefined when absent", () => {
    expect(findCwd("nothing here")).toBeUndefined();
  });
});
