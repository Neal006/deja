import { describe, expect, it } from "vitest";
import { resolveOpenAIUpstream, resolveUpstream } from "../src/cli/upstream.js";

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

describe("resolveOpenAIUpstream", () => {
  it("defaults to api.openai.com", () => {
    expect(resolveOpenAIUpstream(undefined, {})).toBe("https://api.openai.com");
  });
  it("strips /v1 from an existing base URL", () => {
    expect(resolveOpenAIUpstream(undefined, { OPENAI_BASE_URL: "https://openrouter.ai/api/v1" })).toBe("https://openrouter.ai/api");
  });
  it("accepts OPENAI_API_BASE", () => {
    expect(resolveOpenAIUpstream(undefined, { OPENAI_API_BASE: "http://localhost:11434/v1/" })).toBe("http://localhost:11434");
  });
  it("ignores the base URL when nested inside deja", () => {
    expect(resolveOpenAIUpstream(undefined, { OPENAI_BASE_URL: "http://127.0.0.1:9/v1", DEJA_ACTIVE: "1" })).toBe("https://api.openai.com");
  });
  it("prefers the flag", () => {
    expect(resolveOpenAIUpstream("https://x", { OPENAI_BASE_URL: "https://y" })).toBe("https://x");
  });
});
