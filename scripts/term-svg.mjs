#!/usr/bin/env node
/**
 * Render ANSI-coloured terminal text (stdin) as an SVG "screenshot".
 * Dev-only; used to produce the README images (`npm run docs:image`).
 *
 *   FORCE_COLOR=1 node dist/cli.js audit | head -10 | node scripts/term-svg.mjs > docs/audit.svg
 */
import { readFileSync } from "node:fs";

const COLORS = { 31: "#ff6b6b", 32: "#7ee787", 33: "#f2cc60", 35: "#d2a8ff", 36: "#79c0ff", 39: null };
const FG = "#e6edf3";
const DIM = "#8b949e";
const CHAR_W = 8.4;
const LINE_H = 20;
const PAD = 20;

const input = readFileSync(0, "utf8").replace(/\r/g, "").replace(/\n+$/, "");
const lines = input.split("\n");

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Split one line into styled runs. */
function runs(line) {
  const out = [];
  let color = null;
  let bold = false;
  let dim = false;
  let text = "";
  const flush = () => {
    if (text) out.push({ text, color, bold, dim });
    text = "";
  };
  const re = /\x1b\[(\d+)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    text += line.slice(last, m.index);
    flush();
    const code = Number(m[1]);
    if (code in COLORS) color = COLORS[code];
    else if (code === 1) bold = true;
    else if (code === 2) dim = true;
    else if (code === 22) {
      bold = false;
      dim = false;
    }
    last = re.lastIndex;
  }
  text += line.slice(last);
  flush();
  return out;
}

const width = Math.max(...lines.map((l) => [...l.replace(/\x1b\[\d+m/g, "")].length)) * CHAR_W + PAD * 2;
const height = lines.length * LINE_H + PAD * 2 + 28;

const body = lines
  .map((line, i) => {
    const y = PAD + 28 + (i + 1) * LINE_H - 5;
    const spans = runs(line)
      .map((r) => {
        const fill = r.dim ? DIM : (r.color ?? FG);
        return `<tspan fill="${fill}"${r.bold ? ' font-weight="700"' : ""}>${esc(r.text)}</tspan>`;
      })
      .join("");
    return `<text x="${PAD}" y="${y}" xml:space="preserve">${spans}</text>`;
  })
  .join("\n  ");

process.stdout.write(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${height}" viewBox="0 0 ${Math.ceil(width)} ${height}">
  <rect width="100%" height="100%" rx="10" fill="#0d1117"/>
  <circle cx="22" cy="20" r="6" fill="#ff5f56"/><circle cx="42" cy="20" r="6" fill="#ffbd2e"/><circle cx="62" cy="20" r="6" fill="#27c93f"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">
  ${body}
  </g>
</svg>
`);
