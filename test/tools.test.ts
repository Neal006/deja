import { describe, expect, it } from "vitest";
import { FILE_INPUT_TOOLS, longStringChars, mapLongStrings } from "../src/anthropic/tools.js";

const big = "x".repeat(300);

describe("mapLongStrings", () => {
  it("replaces long strings and keeps short ones", () => {
    expect(mapLongStrings({ content: big, mode: "w" }, () => "S")).toEqual({ content: "S", mode: "w" });
  });

  it("never touches identity keys", () => {
    const path = `/${"a".repeat(300)}`;
    expect(mapLongStrings({ file_path: path, content: big }, () => "S")).toEqual({ file_path: path, content: "S" });
  });

  it("recurses into arrays and objects, preserving types", () => {
    const input = { file_path: "/a", edits: [{ old_string: big, new_string: "y", replace_all: false }] };
    expect(mapLongStrings(input, () => "S")).toEqual({
      file_path: "/a",
      edits: [{ old_string: "S", new_string: "y", replace_all: false }],
    });
  });

  it("passes non-string scalars through", () => {
    expect(mapLongStrings(42, () => "S")).toBe(42);
    expect(mapLongStrings(null, () => "S")).toBeNull();
  });
});

describe("longStringChars", () => {
  it("counts only long, non-identity strings", () => {
    expect(longStringChars({ file_path: big, content: big, note: "short" })).toBe(300);
  });
  it("counts nested strings", () => {
    expect(longStringChars({ edits: [{ old_string: big }, { new_string: big }] })).toBe(600);
  });
});

describe("FILE_INPUT_TOOLS", () => {
  it("covers Claude Code write and edit tools", () => {
    for (const t of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) expect(FILE_INPUT_TOOLS.has(t)).toBe(true);
  });
  it("does not include read-only tools", () => {
    expect(FILE_INPUT_TOOLS.has("Read")).toBe(false);
  });
});
