import { describe, expect, it } from "vitest";
import { inputStub, isStub, outline, preview, resultStub } from "../src/decay/stub.js";

const long = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");

describe("preview", () => {
  it("keeps short text whole", () => {
    expect(preview("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("keeps head and tail of long text", () => {
    expect(preview(long)).toEqual(["line 0", "line 1", "…", "line 47", "line 48", "line 49"]);
  });

  it("keeps salient lines in between, in order", () => {
    const log = Array.from({ length: 40 }, (_, i) => (i === 20 ? "FAIL src/a.test.ts > adds" : i === 25 ? "Error: expected 2 to be 3" : `ok ${i}`)).join("\n");
    expect(preview(log)).toEqual(["ok 0", "ok 1", "…", "FAIL src/a.test.ts > adds", "…", "Error: expected 2 to be 3", "…", "ok 37", "ok 38", "ok 39"]);
  });

  it("caps the number of salient lines", () => {
    const log = Array.from({ length: 100 }, (_, i) => `error number ${i}`).join("\n");
    expect(preview(log).filter((l) => l !== "…")).toHaveLength(2 + 6 + 3);
  });

  it("clips very long lines", () => {
    const [line] = preview("x".repeat(500));
    expect(line!.length).toBe(160);
    expect(line!.endsWith("…")).toBe(true);
  });
});

describe("outline", () => {
  it("lists declarations with gutter line numbers", () => {
    const src = ["     1\timport x from 'y';", "     2\t", "     3\texport function parse(a: string) {", "     4\t  return a;", "     5\t}", "     6\texport class Parser {}"].join("\n");
    expect(outline(src)).toEqual(["    3: export function parse(a: string) {", "    6: export class Parser {}"]);
  });

  it("understands several languages", () => {
    const src = ["def run(x):", "    pass", "pub fn main() {}", "func Serve() {}", "const handler = async (req) => {"].join("\n");
    expect(outline(src)).toHaveLength(4);
  });

  it("caps the outline", () => {
    const src = Array.from({ length: 50 }, (_, i) => `function f${i}() {}`).join("\n");
    expect(outline(src)).toHaveLength(14);
  });
});

describe("resultStub", () => {
  it("describes command output and how to get it back", () => {
    const s = resultStub("Bash `npm test`", long, "Bash");
    expect(s).toMatch(/^⟪deja: stale output of Bash `npm test` \(50 lines, ~\d+ tokens\)/);
    expect(s).toContain("Run the tool again");
    expect(s).toContain("line 49");
    expect(isStub(s)).toBe(true);
  });

  it("outlines file reads instead of previewing them", () => {
    const src = Array.from({ length: 60 }, (_, i) => `${String(i + 1).padStart(6)}\t${i % 10 === 0 ? `export function f${i}() {` : "  body();"}`).join("\n");
    const s = resultStub("Read src/a.ts", src, "Read");
    expect(s).toContain("contents of Read src/a.ts");
    expect(s).toContain("Read the file again");
    expect(s).toContain("   11: export function f10() {");
    expect(s).not.toContain("body();");
  });

  it("is much smaller than the original", () => {
    const big = Array.from({ length: 400 }, (_, i) => `PASS test/suite-${i}.test.ts (${i}ms)`).join("\n");
    expect(resultStub("Bash `npm test`", big).length).toBeLessThan(big.length / 10);
  });
});

describe("inputStub", () => {
  it("points the model at the file", () => {
    const s = inputStub("Write src/a.ts", long);
    expect(s).toContain("50 lines you wrote with Write src/a.ts");
    expect(isStub(s)).toBe(true);
  });
});

describe("isStub", () => {
  it("rejects ordinary text", () => expect(isStub("hello")).toBe(false));
});
