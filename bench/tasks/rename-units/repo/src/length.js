// Length conversion. Everything goes through meters.

export const METERS_PER = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
};

function factor(unit) {
  const f = METERS_PER[unit];
  if (f === undefined) throw new Error(`unknown length unit: ${unit}`);
  return f;
}

/** A length in `unit`, expressed in meters. */
export function length_to_meters(value, unit) {
  return value * factor(unit);
}

/** A length in meters, expressed in `unit`. */
export function meters_to_length(meters, unit) {
  return meters / factor(unit);
}

/** Convert a length from one unit to another. */
export function convert_length(value, from, to) {
  return meters_to_length(length_to_meters(value, from), to);
}

/** Every unit this module knows, smallest first. */
export function length_units() {
  return Object.keys(METERS_PER).sort((a, b) => METERS_PER[a] - METERS_PER[b]);
}
