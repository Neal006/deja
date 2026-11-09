import { transformRequest } from "../anthropic/transform.js";
import { CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER } from "../core/pricing.js";
import { addBill, emptyBill, replayAll, type ReplayOptions, type Strategy, type StrategyBills } from "./replay.js";
import { resendCounts, type Transcript } from "./transcript.js";

/**
 * Replay a transcript through deja and measure what it would have saved.
 *
 * Tokens are counted the way they are billed: a tool result sitting in the
 * context is resent with every later request, so its cost is multiplied by
 * the number of requests that carried it.
 */

export interface TargetStat {
  target: string;
  tool: string;
  /** How many results this target produced. */
  calls: number;
  /** Original tokens of all its results, counted once. */
  tokens: number;
  /** Tokens deja removed, counted once. */
  saved: number;
  /** Tokens deja removed, multiplied by how often they were resent. */
  savedSent: number;
  /** Original tokens multiplied by how many requests carried them. */
  sent: number;
}

export interface SessionStat {
  path: string;
  sessionId?: string;
  cwd?: string;
  model?: string;
  /** A subagent's own transcript rather than a main session. */
  subagent?: boolean;
  start?: number;
  end?: number;
  requests: number;
  toolResults: number;
  compressed: number;
  /** Tool-result tokens counted once. */
  toolTokens: number;
  /** Tool-result tokens multiplied by resends: what the API actually saw. */
  toolTokensSent: number;
  saved: number;
  savedSent: number;
  /** Savings expressed in "base input token" units, cache-aware. */
  weightedSaved: number;
  targets: Map<string, TargetStat>;
  /** Cache-aware bills per strategy, when replayed. */
  bills?: Partial<StrategyBills>;
  /**
   * For each segment that ended in an auto-compaction: the context size at
   * that moment as recorded, and as it would have been with deja.
   */
  compactions: Array<{ baseline: number; deja: number }>;
}

export interface SimulateOptions extends ReplayOptions {
  /** Strategies to replay and bill. Empty skips the (slower) replay. */
  strategies?: readonly Strategy[];
}

/** Claude Code keeps subagent transcripts under `<session>/subagents/`. */
export function isSubagentPath(path: string): boolean {
  return /[\\/]subagents[\\/]/.test(path);
}

export function simulate(t: Transcript, opts: SimulateOptions = {}): SessionStat {
  const s: SessionStat = {
    path: t.path,
    sessionId: t.sessionId,
    cwd: t.cwd,
    model: t.model,
    ...(isSubagentPath(t.path) ? { subagent: true } : {}),
    start: t.start,
    end: t.end,
    requests: 0,
    toolResults: 0,
    compressed: 0,
    toolTokens: 0,
    toolTokensSent: 0,
    saved: 0,
    savedSent: 0,
    weightedSaved: 0,
    targets: new Map(),
    compactions: [],
  };

  for (const seg of t.segments) {
    const counts = resendCounts(seg.messages);
    s.requests += seg.messages.filter((m) => m.role === "assistant").length;
    const system = t.cwd ? `Working directory: ${t.cwd}` : undefined;
    const r = transformRequest(
      { system, messages: seg.messages },
      {
        onResult(info) {
          const resends = counts[info.messageIndex] ?? 0;
          const saved = info.tokensBefore - info.tokensAfter;
          let ts = s.targets.get(info.target);
          if (!ts) {
            ts = { target: info.target, tool: info.tool, calls: 0, tokens: 0, saved: 0, savedSent: 0, sent: 0 };
            s.targets.set(info.target, ts);
          }
          ts.calls++;
          ts.tokens += info.tokensBefore;
          ts.saved += saved;
          ts.savedSent += saved * resends;
          ts.sent += info.tokensBefore * resends;
        },
      },
    );
    s.toolResults += r.stats.toolResults;
    s.compressed += r.stats.compressed;
    r.savedByMessage.forEach((saved, i) => {
      const resends = counts[i] ?? 0;
      const tool = r.toolTokensByMessage[i] ?? 0;
      s.toolTokens += tool;
      s.toolTokensSent += tool * resends;
      s.saved += saved;
      s.savedSent += saved * resends;
      if (resends > 0) {
        // First send is a cache write, every later one a cache read.
        s.weightedSaved += saved * (CACHE_WRITE_MULTIPLIER + (resends - 1) * CACHE_READ_MULTIPLIER);
      }
    });
    const strategies = opts.strategies ?? [];
    if (strategies.length > 0) {
      const bills = replayAll(seg, { ...opts, cwd: t.cwd }, strategies);
      s.bills ??= {};
      for (const k of strategies) s.bills[k] = addBill(s.bills[k] ?? emptyBill(), bills[k]!);
      if (seg.compacted && bills.baseline && bills.deja && bills.baseline.requests > 0) {
        s.compactions.push({ baseline: bills.baseline.lastPrompt, deja: bills.deja.lastPrompt });
      }
    }
  }
  return s;
}
