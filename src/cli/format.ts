/** Tiny ANSI helpers that respect NO_COLOR and non-TTY output. */

export function useColor(stream: NodeJS.WriteStream = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY);
}

export interface Paint {
  bold(s: string): string;
  dim(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
  magenta(s: string): string;
  red(s: string): string;
}

const wrap = (on: boolean, open: number, close: number) => (s: string) => (on ? `\x1b[${open}m${s}\x1b[${close}m` : s);

export function paint(on: boolean): Paint {
  return {
    bold: wrap(on, 1, 22),
    dim: wrap(on, 2, 22),
    green: wrap(on, 32, 39),
    yellow: wrap(on, 33, 39),
    cyan: wrap(on, 36, 39),
    magenta: wrap(on, 35, 39),
    red: wrap(on, 31, 39),
  };
}

export function usd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** A fixed-width bar such as `█████░░░░░`. */
export function bar(fraction: number, width = 24): string {
  const f = Math.min(1, Math.max(0, fraction));
  const full = Math.round(f * width);
  return "█".repeat(full) + "░".repeat(width - full);
}
