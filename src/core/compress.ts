import { Dictionary, literalSource, type Source } from "./dictionary.js";
import { isNumbered, splitLines } from "./lines.js";
import { DEFAULT_MATCH, findSegments, type MatchOptions } from "./match.js";
import { render } from "./render.js";
import { estimateTokens } from "./tokens.js";

export interface CompressOptions extends MatchOptions {
  /** Below this many lines a tool result is never compressed. */
  minInputLines: number;
  /** Minimum absolute saving, in estimated tokens, to apply compression. */
  minSavedTokens: number;
  /** Minimum relative saving (0-1) to apply compression. */
  minSavedRatio: number;
}

export const DEFAULT_COMPRESS: CompressOptions = {
  ...DEFAULT_MATCH,
  minInputLines: 12,
  minSavedTokens: 100,
  minSavedRatio: 0.2,
};

export interface CompressResult {
  /** The text to show the model. Equal to the input when unchanged. */
  text: string;
  changed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  /** The visible form of this text, to add to the dictionary. */
  source: Source;
}

/**
 * Compress one piece of text against everything visible before it.
 *
 * This is a pure function of `(text, dict contents, options)`. Given the same
 * conversation prefix it always yields byte-identical output, which is what
 * keeps provider-side prompt caches valid across requests.
 */
export function compressText(
  id: string,
  label: string,
  text: string,
  dict: Dictionary,
  opts: CompressOptions = DEFAULT_COMPRESS,
): CompressResult {
  const lines = splitLines(text);
  const numbered = isNumbered(lines);
  const tokensBefore = estimateTokens(text);
  const unchanged = (): CompressResult => ({
    text,
    changed: false,
    tokensBefore,
    tokensAfter: tokensBefore,
    source: literalSource(id, label, lines, numbered),
  });

  if (lines.length < opts.minInputLines || dict.size === 0) return unchanged();

  const segments = findSegments(lines, dict, opts);
  if (!segments.some((s) => s.kind === "ref")) return unchanged();

  const rendered = render(segments, numbered, lines.length);
  // Preserve a trailing newline if the original had one.
  const out = text.endsWith("\n") ? `${rendered.text}\n` : rendered.text;
  const tokensAfter = estimateTokens(out);
  const saved = tokensBefore - tokensAfter;
  if (saved < opts.minSavedTokens || saved / tokensBefore < opts.minSavedRatio) return unchanged();

  return {
    text: out,
    changed: true,
    tokensBefore,
    tokensAfter,
    source: { id, label, numbered, lines: rendered.visible },
  };
}
