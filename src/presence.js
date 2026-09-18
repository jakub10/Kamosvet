// presence.js — how much of the world exists yet.
//
// A player arriving for the first time finds nothing. As their life in
// Kamosféra accumulates, elements of the world appear, always in the same
// order, so that two people at different stages still recognise the same
// place.
//
// Each element carries a scalar from 0 to 1. Zero means the element does
// not exist at all and costs nothing to draw. The value is continuous over
// the element's whole window: at 0.1 it is a suggestion, at 0.5 it is thin
// but present, at 1.0 it is fully itself. Nothing ever pops into being.
//
// Presence rises in practice, but nothing here assumes it cannot fall. Code
// reading these values must handle them moving either way.

// The fixed order of arrival. Everything added to the world later joins the
// end of this list; nothing is ever inserted in the middle, or two players
// would stop recognising each other's world.
export const ELEMENT_ORDER = [
  'sky',
  'clouds',
  'cloudShadows',
  'light',
  'relief',
  'groundCover',
  'trees',
  'strange',
  'monument',
  'brokenLaw',
];

// Where each element fades in, measured on the growth scalar. The windows
// overlap on purpose: something is always halfway in, so growth never feels
// like a sequence of switches.
const WINDOWS = {
  sky: [0.00, 0.18],
  clouds: [0.12, 0.34],
  cloudShadows: [0.28, 0.46],
  light: [0.42, 0.60],
  relief: [0.56, 0.74],
  groundCover: [0.70, 0.86],
  trees: [0.84, 0.95],
  strange: [0.92, 1.00],
  // The one enormous thing. It stands on the far world rather than on the
  // walked ground, so it arrives with relief and is not gated by the bloom.
  monument: [0.55, 0.72],
  // Where one law of reality stops holding. It shapes the shared ground,
  // so like relief it answers to the party mix and not to one person.
  brokenLaw: [0.60, 0.78],
};

// What is actually built. The rest have windows so the order is settled,
// but nothing consumes them yet.
export const ELEMENTS_BUILT =
  ['sky', 'clouds', 'cloudShadows', 'relief', 'groundCover', 'monument',
    'brokenLaw'];

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// The window an element fades in over, so a shader can evaluate presence
// per position instead of being handed one number for the whole world.
export function windowOf(element) {
  return WINDOWS[element] || [0, 1];
}

export function autoPresence(growth, element) {
  const w = WINDOWS[element];
  if (!w) return 0;
  return smoothstep(w[0], w[1], growth);
}

// `overrides` holds a manual value per element, or null to follow growth.
// Tuning by hand must not mean tuning by fighting the growth curve.
export function presenceFrom(growth, overrides = {}) {
  const out = {};
  for (const key of ELEMENT_ORDER) {
    const manual = overrides[key];
    out[key] = (manual === null || manual === undefined)
      ? autoPresence(growth, key)
      : manual;
  }
  return out;
}

export function emptyOverrides() {
  const out = {};
  for (const key of ELEMENT_ORDER) out[key] = null;
  return out;
}
