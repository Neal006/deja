import type { Source, SourceLine } from "./dictionary.js";
import type { Line } from "./lines.js";
import type { RefSegment, Segment } from "./match.js";

/** Opening and closing marks used for every annotation deja writes. */
export const OPEN = "⟨";
export const CLOSE = "⟩";
export const HEADER_OPEN = "⟪deja";
export const HEADER_CLOSE = "⟫";

const ANCHOR_MAX = 60;

export function header(totalLines: number, refLines: number): string {
  return (
    `${HEADER_OPEN}: ${totalLines} lines, ${refLines} of them identical to text already visible ` +
    `earlier in this conversation and shown as ${OPEN}references${CLOSE}. ` +
    `The referenced lines are unchanged and still verbatim earlier in your context.${HEADER_CLOSE}`
  );
}

function range(a: number, b: number): string {
  return a === b ? String(a) : `${a}-${b}`;
}

function anchor(body: string): string {
  const t = body.trim();
  const cut = t.length > ANCHOR_MAX ? `${t.slice(0, ANCHOR_MAX - 1)}…` : t;
  return JSON.stringify(cut);
}

/** Describe where the referenced lines live in the source. */
export function describeTarget(seg: RefSegment): string {
  const src = seg.source;
  const first = src.lines[seg.from]!;
  const last = src.lines[seg.from + seg.len - 1]!;
  if (seg.from === 0 && seg.len === src.lines.length && isWhole(src)) {
    return `all of ${src.label}`;
  }
  if (src.numbered && first.num !== null && last.num !== null) {
    return `${src.label} lines ${range(first.num, last.num)}`;
  }
  return `${src.label}, from ${anchor(first.body)} to ${anchor(last.body)}`;
}

/** A source is whole when its visible lines form one block covering everything. */
function isWhole(src: Source): boolean {
  const lines = src.lines;
  if (lines.length === 0) return false;
  return lines[0]!.block === lines[lines.length - 1]!.block && lines[lines.length - 1]!.pos === lines.length;
}

export function renderRef(seg: RefSegment, newNumbered: boolean): string {
  const target = describeTarget(seg);
  const first = seg.lines[0]!;
  const last = seg.lines[seg.lines.length - 1]!;
  if (newNumbered && first.num !== null && last.num !== null) {
    const gutter = range(first.num, last.num).padStart(6);
    return `${gutter}\t${OPEN}same as ${target}${CLOSE}`;
  }
  const noun = seg.len === 1 ? "line" : "lines";
  return `${OPEN}${seg.len} ${noun} same as ${target}${CLOSE}`;
}

export interface Rendered {
  text: string;
  /** Lines of the new output still literally visible after rendering. */
  visible: SourceLine[];
  refLines: number;
}

export function render(segments: Segment[], newNumbered: boolean, totalLines: number): Rendered {
  const out: string[] = [];
  const visible: SourceLine[] = [];
  let refLines = 0;
  let pos = 1;
  let block = 0;
  for (const seg of segments) {
    if (seg.kind === "ref") {
      out.push(renderRef(seg, newNumbered));
      refLines += seg.len;
      pos += seg.len;
      block++;
      continue;
    }
    for (const line of seg.lines) {
      out.push(line.raw);
      visible.push(toSourceLine(line, pos++, block));
    }
  }
  return { text: [header(totalLines, refLines), ...out].join("\n"), visible, refLines };
}

function toSourceLine(line: Line, pos: number, block: number): SourceLine {
  return { body: line.body, num: line.num, pos, block };
}
