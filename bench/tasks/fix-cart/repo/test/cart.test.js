import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount, checkout, formatPrice, itemCount, lineTotal, mergeLines, subtotal, tax } from "../src/cart.js";

const items = [
  { sku: "pen", price: 1000, qty: 2 },
  { sku: "ink", price: 250, qty: 4 },
];

test("lineTotal multiplies price by quantity", () => {
  assert.equal(lineTotal({ price: 199, qty: 3 }), 597);
  assert.throws(() => lineTotal({ price: 1.5, qty: 1 }), TypeError);
  assert.throws(() => lineTotal({ price: 100, qty: -1 }), RangeError);
});

test("subtotal adds every line", () => {
  assert.equal(subtotal(items), 3000);
  assert.equal(subtotal([{ price: 500, qty: 1 }]), 500);
  assert.equal(subtotal([]), 0);
});

test("applyDiscount takes the share off the total", () => {
  assert.equal(applyDiscount(1000, "SAVE10"), 900);
  assert.equal(applyDiscount(1000, "SAVE25"), 750);
  assert.equal(applyDiscount(999, "HALF"), 500);
  assert.throws(() => applyDiscount(1000, "FREE"), /unknown code/);
});

test("tax rounds to whole cents", () => {
  assert.equal(tax(2700, 8), 216);
  assert.equal(tax(1005, 10), 101);
  assert.throws(() => tax(100, -1), RangeError);
});

test("formatPrice always shows two cent digits", () => {
  assert.equal(formatPrice(1234), "$12.34");
  assert.equal(formatPrice(5), "$0.05");
  assert.equal(formatPrice(100), "$1.00");
  assert.equal(formatPrice(-250), "-$2.50");
});

test("itemCount and mergeLines", () => {
  assert.equal(itemCount(items), 6);
  assert.deepEqual(mergeLines([...items, { sku: "pen", price: 1000, qty: 1 }])[0].qty, 3);
});

test("checkout applies discount, then tax", () => {
  assert.deepEqual(checkout(items, { code: "SAVE10", taxRate: 8 }), { total: 2916, display: "$29.16", count: 6 });
  assert.deepEqual(checkout(items), { total: 3000, display: "$30.00", count: 6 });
});
