/**
 * Fast, dependency-free token estimation.
 *
 * Real tokenizers are model-specific and heavy. For budgeting and savings
 * accounting we only need a stable, roughly-right estimate. Code and logs
 * average ~3.5-4 characters per token across modern BPE tokenizers; we
 * refine that slightly by counting whitespace runs and punctuation, which
 * tokenize poorly compared to plain words.
 */

const PUNCT_CHARS = `{}()[];,.<>:=+-*/%!&|^~?@#$"'\`\\`;
const IS_PUNCT = new Uint8Array(128);
for (const ch of PUNCT_CHARS) IS_PUNCT[ch.charCodeAt(0)] = 1;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  let punct = 0;
  let newlines = 0;
  for (let i = 0; i < chars; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) newlines++;
    else if (c < 128 && IS_PUNCT[c] === 1) punct++;
  }
  // Base: 4 chars per token. Punctuation tends to be its own token, and
  // newlines are usually merged with indentation into a single token.
  const base = (chars - punct - newlines) / 4;
  return Math.max(1, Math.round(base + punct * 0.7 + newlines * 0.5));
}

export function countChar(text: string, ch: string): number {
  let n = 0;
  let i = text.indexOf(ch);
  while (i !== -1) {
    n++;
    i = text.indexOf(ch, i + 1);
  }
  return n;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return String(n);
}
