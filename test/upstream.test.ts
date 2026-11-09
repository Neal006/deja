import { describe, expect, it } from "vitest";
import { resolveUpstream } from "../src/cli/upstream.js";

describe("resolveUpstream", () => {
  it("prefers the flag", () => {
    expect(resolveUpstream("https://flag", { DEJA_UPSTREAM: "https://env" })).toBe("https://flag");
  });
  it("uses DEJA_UPSTREAM", () => {
    expect(resolveUpstream(undefined, { DEJA_UPSTREAM: "https://env" })).toBe("https://env");
  });
  it("chains in front of an existing gateway", () => {
    expect(resolveUpstream(undefined, { ANTHROPIC_BASE_URL: "https://gw.corp" })).toBe("https://gw.corp");
  });
  it("ignores a base URL pointing at a local deja", () => {
    expect(resolveUpstream(undefined, { ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" })).toBe("https://api.anthropic.com");
  });
  it("ignores the base URL when nested inside deja", () => {
    expect(resolveUpstream(undefined, { ANTHROPIC_BASE_URL: "http://127.0.0.1:5555", DEJA_ACTIVE: "1" })).toBe(
      "https://api.anthropic.com",
    );
  });
  it("defaults to the public API", () => {
    expect(resolveUpstream(undefined, {})).toBe("https://api.anthropic.com");
  });
});
