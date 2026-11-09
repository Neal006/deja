import { isTrivial, type Line } from "./lines.js";
import type { Dictionary, Source } from "./dictionary.js";

export interface LiteralSegment {
  kind: "lit";
  lines: Line[];
}

export interface RefSegment {
  kind: "ref";
  source: Source;
  /** Index into `source.lines` of the first referenced line. */
  from: number;
  /** Number of lines referenced. */
  len: number;
  /** The new lines this reference replaces. */
  lines: Line[];
}

export type Segment = LiteralSegment | RefSegment;

export interface MatchOptions {
  /** Minimum number of lines a reference must cover. */
  minLines: number;
  /** Minimum number of non-whitespace characters a reference must cover. */
  minChars: number;
}

export const DEFAULT_MATCH: MatchOptions = { minLines: 6, minChars: 160 };

interface Run {
  source: Source;
  from: number;
  len: number;
}

/**
 * Greedy LZ77-style parse of `lines` against everything in `dict`.
 *
 * At each position we look up earlier visible lines with the same body,
 * extend each candidate forward as far as the content keeps matching (within
 * one contiguous visible block), and take the longest run. Ties go to the
 * most recent source, which is the one most likely to still be salient for
 * the model.
 */
export function findSegments(lines: Line[], dict: Dictionary, opts: MatchOptions = DEFAULT_MATCH): Segment[] {
  const segments: Segment[] = [];
  let pending: Line[] = [];

  const flush = () => {
    if (pending.length > 0) {
      segments.push({ kind: "lit", lines: pending });
      pending = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const run = isTrivial(line.body) ? null : longestRun(lines, i, dict);
    if (run && worthReferencing(lines, i, run.len, opts)) {
      flush();
      segments.push({
        kind: "ref",
        source: run.source,
        from: run.from,
        len: run.len,
        lines: lines.slice(i, i + run.len),
      });
      i += run.len;
    } else {
      pending.push(line);
      i++;
    }
  }
  flush();
  return mergeAdjacentRefs(segments);
}

function longestRun(lines: Line[], start: number, dict: Dictionary): Run | null {
  const hits = dict.candidates(lines[start]!.body);
  let best: Run | null = null;
  // Iterate newest first so that ties resolve to the most recent source.
  for (let h = hits.length - 1; h >= 0; h--) {
    const hit = hits[h]!;
    const src = hit.source.lines;
    const block = src[hit.index]!.block;
    let len = 0;
    while (
      start + len < lines.length &&
      hit.index + len < src.length &&
      src[hit.index + len]!.block === block &&
      src[hit.index + len]!.body === lines[start + len]!.body
    ) {
      len++;
    }
    if (!best || len > best.len) best = { source: hit.source, from: hit.index, len };
  }
  return best;
}

function worthReferencing(lines: Line[], start: number, len: number, opts: MatchOptions): boolean {
  if (len < opts.minLines) return false;
  let chars = 0;
  let meaningful = 0;
  for (let k = start; k < start + len; k++) {
    const body = lines[k]!.body;
    chars += body.replace(/\s+/g, "").length;
    if (!isTrivial(body)) meaningful++;
  }
  return chars >= opts.minChars && meaningful >= Math.ceil(opts.minLines / 2);
}

/**
 * Merge references that are contiguous both in the new output and in the
 * same source block. This happens when a long run was split, e.g. because a
 * line inside it was trivial and could not start a run on its own.
 */
function mergeAdjacentRefs(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (
      seg.kind === "ref" &&
      prev?.kind === "ref" &&
      prev.source === seg.source &&
      prev.from + prev.len === seg.from &&
      prev.source.lines[seg.from]?.block === prev.source.lines[prev.from]?.block
    ) {
      prev.len += seg.len;
      prev.lines = prev.lines.concat(seg.lines);
      continue;
    }
    out.push(seg);
  }
  return out;
}
