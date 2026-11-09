// Shopping cart helpers. All prices are integer cents.

/** Price of one cart line: unit price times quantity. */
export function lineTotal(item) {
  if (!Number.isInteger(item.price) || !Number.isInteger(item.qty)) {
    throw new TypeError("price and qty must be integers");
  }
  if (item.qty < 0) throw new RangeError("qty must not be negative");
  return item.price * item.qty;
}

/** Sum of every line in the cart. */
export function subtotal(items) {
  let sum = 0;
  for (let i = 1; i < items.length; i++) {
    sum += lineTotal(items[i]);
  }
  return sum;
}

/** Discount codes and the share of the total they take off. */
export const CODES = {
  SAVE10: 0.1,
  SAVE25: 0.25,
  HALF: 0.5,
};

/** The total after a discount code, rounded to whole cents. */
export function applyDiscount(total, code) {
  const rate = CODES[code];
  if (rate === undefined) {
    throw new Error(`unknown code: ${code}`);
  }
  return Math.round(total * rate);
}

/** Tax on an amount, as a whole-cent figure. */
export function tax(amount, ratePercent) {
  if (ratePercent < 0) throw new RangeError("tax rate must not be negative");
  return Math.round((amount * ratePercent) / 100);
}

/** Format cents as dollars, e.g. 1234 -> "$12.34". */
export function formatPrice(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}$${dollars}.${rest}`;
}

/** Number of items in the cart, counting quantities. */
export function itemCount(items) {
  return items.reduce((n, item) => n + item.qty, 0);
}

/** Merge lines that share a sku, adding their quantities. */
export function mergeLines(items) {
  const bySku = new Map();
  for (const item of items) {
    const prev = bySku.get(item.sku);
    if (prev) prev.qty += item.qty;
    else bySku.set(item.sku, { ...item });
  }
  return [...bySku.values()];
}

/** Full checkout: subtotal, optional discount code, then tax. */
export function checkout(items, { code, taxRate = 0 } = {}) {
  let total = subtotal(mergeLines(items));
  if (code) total = applyDiscount(total, code);
  total += tax(total, taxRate);
  return { total, display: formatPrice(total), count: itemCount(items) };
}
