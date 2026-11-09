import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dejaHome } from "../core/ledger.js";

/**
 * A tiny per-proxy status file so other processes (Claude Code's status
 * line, scripts) can show what the running proxy has saved so far.
 * Keyed by port, since that is what an agent's base URL tells us.
 */

export interface LiveTally {
  port: number;
  pid: number;
  started: number;
  requests: number;
  saved: number;
  usd: number;
  /** Stubs currently applied in the most recent request. */
  evicted: number;
}

export function liveDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(dejaHome(env), "live");
}

export function livePath(port: number, env: NodeJS.ProcessEnv = process.env): string {
  return join(liveDir(env), `${port}.json`);
}

export function writeLive(t: LiveTally, env: NodeJS.ProcessEnv = process.env): void {
  const path = livePath(t.port, env);
  mkdirSync(liveDir(env), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(t));
  renameSync(tmp, path);
}

export function readLive(port: number, env: NodeJS.ProcessEnv = process.env): LiveTally | undefined {
  try {
    return JSON.parse(readFileSync(livePath(port, env), "utf8")) as LiveTally;
  } catch {
    return undefined;
  }
}

export function removeLive(port: number, env: NodeJS.ProcessEnv = process.env): void {
  rmSync(livePath(port, env), { force: true });
}

/** The port of a local deja from a base URL such as http://127.0.0.1:41234. */
export function portFromBaseUrl(url: string | undefined): number | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return undefined;
    const port = Number(u.port);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}
