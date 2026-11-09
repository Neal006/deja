import { describe, expect, it } from "vitest";
import { countChar, estimateTokens, formatTokens } from "../src/core/tokens.js";

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns at least 1 for any non-empty input", () => {
    expect(estimateTokens("a")).toBe(1);
  });

  it("is roughly chars/4 for prose", () => {
    const prose = "the quick brown fox jumps over the lazy dog ".repeat(20);
    const est = estimateTokens(prose);
    expect(est).toBeGreaterThan(prose.length / 6);
    expect(est).toBeLessThan(prose.length / 3);
  });

  it("charges more for punctuation-heavy code", () => {
    const code = "if(a){b[c]=d;}".repeat(10);
    const prose = "abcdefghijklmn".repeat(10);
    expect(estimateTokens(code)).toBeGreaterThan(estimateTokens(prose));
  });

  it("grows monotonically with repeated content", () => {
    const a = estimateTokens("hello world\n");
    const b = estimateTokens("hello world\n".repeat(2));
    expect(b).toBeGreaterThan(a);
  });
});

describe("countChar", () => {
  it("counts occurrences", () => {
    expect(countChar("a\nb\nc", "\n")).toBe(2);
    expect(countChar("abc", "\n")).toBe(0);
  });
});

describe("formatTokens", () => {
  it("formats small numbers plainly", () => {
    expect(formatTokens(999)).toBe("999");
  });
  it("formats thousands", () => {
    expect(formatTokens(1500)).toBe("1.50k");
    expect(formatTokens(15000)).toBe("15.0k");
  });
  it("formats millions", () => {
    expect(formatTokens(2_500_000)).toBe("2.50M");
  });
});
