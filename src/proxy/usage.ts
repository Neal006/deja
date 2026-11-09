/**
 * Read the provider's own token accounting out of a response as it streams
 * past, without altering it. This turns deja's estimates into measurements:
 * how many input tokens were billed, and how many were cache reads/writes.
 *
 * Handles both plain JSON responses and server-sent event streams, where
 * usage arrives in `message_start` and is updated by `message_delta`.
 */

export interface Usage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

const MAX_BUFFER = 1 << 20;

interface RawUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
}

function merge(into: Usage | undefined, raw: RawUsage): Usage {
  const u = into ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  if (typeof raw.input_tokens === "number") u.input = raw.input_tokens;
  if (typeof raw.cache_read_input_tokens === "number") u.cacheRead = raw.cache_read_input_tokens;
  if (typeof raw.cache_creation_input_tokens === "number") u.cacheWrite = raw.cache_creation_input_tokens;
  if (typeof raw.output_tokens === "number") u.output = raw.output_tokens;
  return u;
}

export class UsageSniffer {
  private pending = "";
  private whole = "";
  private overflow = false;
  private sse = false;
  usage: Usage | undefined;

  feed(chunk: string): void {
    if (!this.overflow) {
      this.whole += chunk;
      if (this.whole.length > MAX_BUFFER) {
        this.overflow = true;
        this.whole = "";
      }
    }
    this.pending += chunk;
    let nl = this.pending.indexOf("\n");
    while (nl !== -1) {
      this.line(this.pending.slice(0, nl));
      this.pending = this.pending.slice(nl + 1);
      nl = this.pending.indexOf("\n");
    }
    // Guard against a pathological stream without newlines.
    if (this.pending.length > MAX_BUFFER) this.pending = "";
  }

  private line(line: string): void {
    if (line.startsWith("event:")) {
      this.sse = true;
      return;
    }
    if (!line.startsWith("data:") || !line.includes('"usage"')) return;
    this.sse = true;
    try {
      const data = JSON.parse(line.slice(5)) as { message?: { usage?: RawUsage }; usage?: RawUsage };
      const raw = data.message?.usage ?? data.usage;
      if (raw) this.usage = merge(this.usage, raw);
    } catch {
      // Not every data line is JSON we care about.
    }
  }

  finish(): Usage | undefined {
    if (this.pending) this.line(this.pending);
    this.pending = "";
    if (!this.sse && !this.overflow && this.whole.trimStart().startsWith("{")) {
      try {
        const body = JSON.parse(this.whole) as { usage?: RawUsage };
        if (body.usage) this.usage = merge(this.usage, body.usage);
      } catch {
        // Not JSON after all.
      }
    }
    this.whole = "";
    return this.usage;
  }
}
