import { describe, expect, it } from "vitest";
import { isNumbered, isTrivial, parseLine, splitLines } from "../src/core/lines.js";

describe("parseLine", () => {
  it("strips tab gutters", () => {
    expect(parseLine("    12\tconst a = 1;")).toEqual({
      raw: "    12\tconst a = 1;",
      body: "const a = 1;",
      num: 12,
    });
  });

  it("strips arrow gutters", () => {
    const l = parseLine("     3→import x from 'y';");
    expect(l.body).toBe("import x from 'y';");
    expect(l.num).toBe(3);
  });

  it("leaves plain lines alone", () => {
    const l = parseLine("PASS src/a.test.ts");
    expect(l.body).toBe("PASS src/a.test.ts");
    expect(l.num).toBeNull();
  });

  it("does not treat colon-numbered log lines as gutters", () => {
    expect(parseLine("12:30 server started").num).toBeNull();
  });

  it("keeps an empty body for blank numbered lines", () => {
    const l = parseLine("     7\t");
    expect(l.body).toBe("");
    expect(l.num).toBe(7);
  });
});

describe("splitLines", () => {
  it("returns no lines for empty text", () => {
    expect(splitLines("")).toEqual([]);
  });

  it("ignores a single trailing newline", () => {
    expect(splitLines("a\nb\n").map((l) => l.body)).toEqual(["a", "b"]);
  });

  it("keeps interior blank lines", () => {
    expect(splitLines("a\n\nb").map((l) => l.body)).toEqual(["a", "", "b"]);
  });
});

describe("isNumbered", () => {
  it("detects Read-style output", () => {
    expect(isNumbered(splitLines("     1\ta\n     2\tb\n     3\tc"))).toBe(true);
  });
  it("rejects plain output", () => {
    expect(isNumbered(splitLines("a\nb\nc"))).toBe(false);
  });
  it("rejects empty input", () => {
    expect(isNumbered([])).toBe(false);
  });
});

describe("isTrivial", () => {
  it("flags braces and blanks", () => {
    expect(isTrivial("")).toBe(true);
    expect(isTrivial("  }")).toBe(true);
    expect(isTrivial("});")).toBe(true);
    expect(isTrivial("  ]);  ")).toBe(true);
  });
  it("keeps real code", () => {
    expect(isTrivial("return x + y;")).toBe(false);
  });
});
