import { test } from "node:test";
import assert from "node:assert/strict";
import { convertLength, lengthToMeters, lengthUnits, metersToLength } from "../src/length.js";
import { celsiusToFahrenheit, convertTemperature, fahrenheitToCelsius } from "../src/temperature.js";
import { describeLog, describeTrip, describeWeather } from "../src/report.js";

test("length", () => {
  assert.equal(lengthToMeters(2, "km"), 2000);
  assert.equal(metersToLength(1609.344, "mi"), 1);
  assert.ok(Math.abs(convertLength(1, "ft", "in") - 12) < 1e-9);
  assert.deepEqual(lengthUnits().slice(0, 3), ["mm", "cm", "in"]);
  assert.throws(() => lengthToMeters(1, "league"), /unknown length unit/);
});

test("temperature", () => {
  assert.equal(celsiusToFahrenheit(100), 212);
  assert.equal(fahrenheitToCelsius(32), 0);
  assert.ok(Math.abs(convertTemperature(0, "C", "K") - 273.15) < 1e-9);
  assert.throws(() => convertTemperature(1, "C", "X"), /unknown temperature unit/);
});

test("report", () => {
  assert.equal(describeTrip(12), "12 km (7.46 mi)");
  assert.equal(describeWeather(20), "20 °C (68 °F)");
  assert.equal(describeLog([{ day: "Mon", km: 12, celsius: 20 }]), "Mon: 12 km (7.46 mi), 20 °C (68 °F)");
});
