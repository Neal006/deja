import { describe, expect, it } from "vitest";
import { inputStub, isStub, preview, resultStub } from "../src/decay/stub.js";

const long = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");

describe("preview", () => {
  it("keeps short text whole", () => {
    expect(preview("a\nb\nc")).toEqual(["a", "b", "c"]);
  });
  it("keeps head and tail of long text", () => {
    expect(preview(long)).toEqual(["line 0", "line 1", "…", "line 47", "line 48", "line 49"]);
  });
  it("clips very long lines", () => {
    const [line] = preview("x".repeat(500));
    expect(line!.length).toBe(160);
    expect(line!.endsWith("…")).toBe(true);
  });
});

describe("resultStub", () => {
  it("describes what was removed and how to get it back", () => {
    const s = resultStub("Bash `npm test`", long);
    expect(s).toMatch(/^⟪deja: stale output of Bash `npm test` \(50 lines, ~\d+ tokens\)/);
    expect(s).toContain("Run the tool again");
    expect(s).toContain("line 49");
    expect(isStub(s)).toBe(true);
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
