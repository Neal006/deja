import { DEFAULT_UPSTREAM } from "../proxy/server.js";

/**
 * Decide where deja forwards traffic.
 *
 * Priority: explicit flag, DEJA_UPSTREAM, a pre-existing ANTHROPIC_BASE_URL
 * (so deja can sit in front of a corporate gateway), then the public API.
 * A base URL that points at a local deja would make us call ourselves, so it
 * is ignored.
 */
export function resolveUpstream(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (flag) return flag;
  if (env.DEJA_UPSTREAM) return env.DEJA_UPSTREAM;
  const base = env.ANTHROPIC_BASE_URL;
  if (base && !isLocalDeja(base, env)) return base;
  return DEFAULT_UPSTREAM;
}

function isLocalDeja(url: string, env: NodeJS.ProcessEnv): boolean {
  if (env.DEJA_ACTIVE === "1") return true;
  try {
    const u = new URL(url);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port === (env.DEJA_PORT ?? "8787");
  } catch {
    return false;
  }
}

export const OPENAI_UPSTREAM = "https://api.openai.com";

/**
 * Upstream for OpenAI-compatible agents: flag, DEJA_UPSTREAM, an existing
 * OPENAI_BASE_URL / OPENAI_API_BASE (minus a trailing /v1, since clients add
 * the path themselves), then api.openai.com.
 */
export function resolveOpenAIUpstream(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (flag) return flag;
  if (env.DEJA_UPSTREAM) return env.DEJA_UPSTREAM;
  const base = env.OPENAI_BASE_URL || env.OPENAI_API_BASE;
  if (base && env.DEJA_ACTIVE !== "1") return base.replace(/\/v1\/?$/, "");
  return OPENAI_UPSTREAM;
}
