import { isTrivial, type Line } from "./lines.js";

/**
 * A line that is *visible* to the model somewhere earlier in the context.
 *
 * Only literally visible lines may be referenced. If an earlier tool result
 * was itself compressed, its references are not content and must never be
 * pointed at, otherwise the model would have to chase reference chains.
 */
export interface SourceLine {
  body: string;
  /** Gutter line number as displayed, when the source is numbered. */
  num: number | null;
  /** 1-based position of the line in the source's original output. */
  pos: number;
  /** Lines in the same block are contiguous in the visible text. */
  block: number;
}

export interface Source {
  /** Stable identifier, e.g. the tool_use id. */
  id: string;
  /** Human/model readable description, e.g. `Read src/app.ts`. */
  label: string;
  /** Whether the visible lines carry gutter line numbers. */
  numbered: boolean;
  lines: SourceLine[];
}

export interface Hit {
  source: Source;
  /** Index into `source.lines`. */
  index: number;
}

/** Max candidate positions we keep per distinct line body. */
const MAX_CANDIDATES = 48;

/**
 * An index over every visible line of earlier context, keyed by line body.
 * Insertion order is chronological, so later candidates are more recent.
 */
export class Dictionary {
  readonly sources: Source[] = [];
  private readonly index = new Map<string, Hit[]>();

  add(source: Source): void {
    this.sources.push(source);
    source.lines.forEach((line, index) => {
      if (isTrivial(line.body)) return;
      let hits = this.index.get(line.body);
      if (!hits) {
        hits = [];
        this.index.set(line.body, hits);
      }
      hits.push({ source, index });
      if (hits.length > MAX_CANDIDATES) hits.shift();
    });
  }

  candidates(body: string): readonly Hit[] {
    return this.index.get(body) ?? [];
  }

  get size(): number {
    return this.sources.length;
  }
}

/** Build a fully-literal source from freshly parsed lines. */
export function literalSource(id: string, label: string, lines: Line[], numbered: boolean): Source {
  return {
    id,
    label,
    numbered,
    lines: lines.map((l, i) => ({ body: l.body, num: l.num, pos: i + 1, block: 0 })),
  };
}
