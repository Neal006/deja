// Human-readable summaries built on the converters.
import { convert_length } from "./length.js";
import { convert_temperature } from "./temperature.js";

function round_to(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** "12 km (7.46 mi)" */
export function describe_trip(km) {
  const miles = round_to(convert_length(km, "km", "mi"), 2);
  return `${km} km (${miles} mi)`;
}

/** "20 °C (68 °F)" */
export function describe_weather(celsius) {
  const f = round_to(convert_temperature(celsius, "C", "F"), 1);
  return `${celsius} °C (${f} °F)`;
}

/** One line per reading, e.g. for a trip log. */
export function describe_log(entries) {
  return entries.map((e) => `${e.day}: ${describe_trip(e.km)}, ${describe_weather(e.celsius)}`).join("\n");
}
