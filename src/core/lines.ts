/**
 * Line model used by the matcher.
 *
 * Tool outputs are compared line by line. Some tools (notably Claude Code's
 * Read tool) prefix every line with a line number such as `    12\t` or
 * `    12→`. Those prefixes shift whenever a line is inserted above, which
 * would make an edited file look entirely different from its previous read.
 * We therefore split each line into an optional numeric gutter and a body,
 * and match on the body only.
 */

export interface Line {
  /** The full original line, exactly as it appeared. */
  raw: string;
  /** The line without any line-number gutter. Used for matching. */
  body: string;
  /** Line number parsed from the gutter, if the line had one. */
  num: number | null;
}

// `     1\tfoo`, `    12→foo`, `12:foo` is NOT matched (too ambiguous with logs).
const GUTTER = /^\s*(\d{1,7})(?:\t|→)/;

export function parseLine(raw: string): Line {
  const m = GUTTER.exec(raw);
  if (m && m[1] !== undefined) {
    return { raw, body: raw.slice(m[0].length), num: Number(m[1]) };
  }
  return { raw, body: raw, num: null };
}

export function splitLines(text: string): Line[] {
  if (text === "") return [];
  const parts = text.split("\n");
  // A trailing newline should not produce a phantom empty line.
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts.map(parseLine);
}

/**
 * Whether a run of text is "gutter numbered", i.e. the majority of its lines
 * carry a line-number gutter. Used to decide how to render references.
 */
export function isNumbered(lines: Line[]): boolean {
  if (lines.length === 0) return false;
  let n = 0;
  for (const l of lines) if (l.num !== null) n++;
  return n / lines.length > 0.8;
}

/**
 * Lines that carry almost no information on their own. A match consisting
 * only of these is not worth referencing: `}` repeated across files is not
 * "the same content".
 */
export function isTrivial(body: string): boolean {
  const t = body.trim();
  if (t.length <= 3) return true;
  return /^[\s{}()[\];,]*$/.test(t);
}
