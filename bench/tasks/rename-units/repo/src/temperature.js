// Temperature conversion between Celsius (C), Fahrenheit (F) and Kelvin (K).

/** Celsius to Fahrenheit. */
export function celsius_to_fahrenheit(c) {
  return (c * 9) / 5 + 32;
}

/** Fahrenheit to Celsius. */
export function fahrenheit_to_celsius(f) {
  return ((f - 32) * 5) / 9;
}

function to_celsius(value, unit) {
  switch (unit) {
    case "C":
      return value;
    case "F":
      return fahrenheit_to_celsius(value);
    case "K":
      return value - 273.15;
    default:
      throw new Error(`unknown temperature unit: ${unit}`);
  }
}

function from_celsius(c, unit) {
  switch (unit) {
    case "C":
      return c;
    case "F":
      return celsius_to_fahrenheit(c);
    case "K":
      return c + 273.15;
    default:
      throw new Error(`unknown temperature unit: ${unit}`);
  }
}

/** Convert a temperature from one unit to another. */
export function convert_temperature(value, from, to) {
  return from_celsius(to_celsius(value, from), to);
}
