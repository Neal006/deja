import { existsSync } from "node:fs";
import { claudeProjectsDir, discoverTranscripts } from "../../audit/discover.js";
import { preview, requestIndices } from "../../audit/preview.js";
import { readTranscript } from "../../audit/transcript.js";
import { estimateTokens, formatTokens } from "../../core/tokens.js";
import { flagNumber, type ParsedArgs } from "../args.js";
import { paint, useColor } from "../format.js";
import { decayConfigFromArgs } from "./start.js";

const MAX_LINES = 24;

function clip(text: string, max = MAX_LINES): string {
  const lines = text.split("\n");
  if (lines.length <= max) return text;
  return [...lines.slice(0, max), `… (${lines.length - max} more lines)`].join("\n");
}

/** Find a transcript by path, or by a session id / path fragment. */
export function locate(query: string | undefined): string | undefined {
  if (query && existsSync(query)) return query;
  const all = discoverTranscripts(claudeProjectsDir(), query ? { match: query } : {});
  return all[0]?.path;
}

export function previewCommand(args: ParsedArgs): number {
  const path = locate(args.positionals[0]);
  if (!path) {
    process.stderr.write("deja: no matching transcript (pass a path, a session id, or nothing for the latest)\n");
    return 1;
  }
  const t = readTranscript(path);
  // Default to the last segment (after any compaction) that has requests.
  const withRequests = t.segments.filter((sg) => requestIndices(sg).length > 0);
  const pick = flagNumber(args.flags, "segment");
  const seg = pick !== undefined ? t.segments[pick - 1] : withRequests[withRequests.length - 1];
  const p = paint(useColor(process.stdout) && args.flags.color !== false);
  const pv = seg && preview(seg, { request: flagNumber(args.flags, "request"), cwd: t.cwd, decay: args.flags.decay === false ? false : decayConfigFromArgs(args) });
  if (!pv) {
    process.stderr.write(`deja: ${path} has no API requests to preview\n`);
    return 1;
  }
  if (args.flags.json === true) {
    process.stdout.write(`${JSON.stringify(pv, null, 2)}\n`);
    return 0;
  }
  const out: string[] = [];
  out.push(`${p.magenta(p.bold("deja preview"))} ${p.dim(path)}`);
  out.push(
    `${t.segments.length > 1 ? `segment ${t.segments.indexOf(seg!) + 1} of ${t.segments.length} · ` : ""}request ${pv.request} of ${pv.totalRequests} · ${pv.blocks.length} blocks rewritten · ${pv.evicted} stale items · ` +
      `tool output ${formatTokens(pv.tokensBefore)} → ${p.bold(formatTokens(pv.tokensAfter))} tokens`,
  );
  for (const b of pv.blocks) {
    out.push("");
    out.push(p.cyan(`── message ${b.messageIndex} · ${b.kind === "result" ? "tool result" : "tool input"} ${b.toolUseId} ──`));
    out.push(
      p.dim(
        `before: ${b.before.split("\n").length} lines, ${formatTokens(estimateTokens(b.before))} tokens → ` +
          `after: ${formatTokens(estimateTokens(b.after))} tokens`,
      ),
    );
    out.push(clip(b.after));
  }
  if (pv.blocks.length === 0) out.push(p.dim("\nNothing to rewrite at this point in the session."));
  process.stdout.write(`${out.join("\n")}\n`);
  return 0;
}
