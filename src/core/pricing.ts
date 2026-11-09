/**
 * Rough per-million-token input prices, used only to put a dollar figure on
 * savings. Override with DEJA_INPUT_PRICE (USD per million input tokens).
 *
 * Prompt caching changes what a saved token is worth:
 *  - tokens new on this request are billed as cache writes (1.25x base)
 *  - tokens carried over from earlier requests are mostly cache reads (0.1x)
 * We value fresh and carried savings separately so the estimate stays honest.
 */

const FAMILY_PRICES: Array<[RegExp, number]> = [
  [/opus/i, 5],
  [/sonnet/i, 3],
  [/haiku/i, 1],
];

export const DEFAULT_INPUT_PRICE = 3;
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export function inputPrice(model: string | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.DEJA_INPUT_PRICE);
  if (Number.isFinite(override) && override > 0) return override;
  if (model) {
    for (const [re, price] of FAMILY_PRICES) if (re.test(model)) return price;
  }
  return DEFAULT_INPUT_PRICE;
}

/** Estimated USD saved for one request. */
export function dollarsSaved(model: string | undefined, freshSaved: number, totalSaved: number, env?: NodeJS.ProcessEnv): number {
  const price = inputPrice(model, env) / 1_000_000;
  const carried = Math.max(0, totalSaved - freshSaved);
  return freshSaved * price * CACHE_WRITE_MULTIPLIER + carried * price * CACHE_READ_MULTIPLIER;
}
