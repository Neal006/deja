import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT_PRICE, dollarsSaved, inputPrice } from "../src/core/pricing.js";

describe("inputPrice", () => {
  it("maps model families", () => {
    expect(inputPrice("claude-opus-4-5", {})).toBe(5);
    expect(inputPrice("claude-sonnet-4-5-20250929", {})).toBe(3);
    expect(inputPrice("claude-haiku-4-5", {})).toBe(1);
  });
  it("falls back to the default", () => {
    expect(inputPrice("some-other-model", {})).toBe(DEFAULT_INPUT_PRICE);
    expect(inputPrice(undefined, {})).toBe(DEFAULT_INPUT_PRICE);
  });
  it("respects an override", () => {
    expect(inputPrice("claude-opus-4-5", { DEJA_INPUT_PRICE: "15" })).toBe(15);
  });
  it("ignores a bogus override", () => {
    expect(inputPrice("claude-haiku-4-5", { DEJA_INPUT_PRICE: "abc" })).toBe(1);
  });
});

describe("dollarsSaved", () => {
  it("values fresh tokens at cache-write price", () => {
    expect(dollarsSaved("sonnet", 1_000_000, 1_000_000, {})).toBeCloseTo(3.75);
  });
  it("values carried tokens at cache-read price", () => {
    expect(dollarsSaved("sonnet", 0, 1_000_000, {})).toBeCloseTo(0.3);
  });
  it("never goes negative when fresh exceeds total", () => {
    expect(dollarsSaved("sonnet", 10, 5, {})).toBeGreaterThan(0);
  });
});
