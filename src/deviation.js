// deviation.js — the personal layer.
//
// A player carries a handful of numbers, not a world. The numbers are
// derived by hashing an identity string (later: a Kamosféra identity —
// posts, connections, activity) and they feed coefficients in the air
// layer only: colour, light, fog, wind, cloud, grain.
//
// Nothing in here may reach the ground. The one exception is the *party*
// deviation at the bottom of this file: a mix of everyone present, which
// both clients compute identically, and which is the only thing the shared
// height function is allowed to read.

import { hash1, unitFloat } from './world.js';

function hashString(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = hash1((h ^ s.charCodeAt(i)) >>> 0);
  }
  return h >>> 0;
}

// n independent unit floats from one seed.
function stream(seed, n) {
  const out = [];
  let h = seed >>> 0;
  for (let i = 0; i < n; i++) {
    h = hash1((h + 0x9e3779b9) >>> 0);
    out.push(unitFloat(h));
  }
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;

// How much of the world exists for this person. This is the one number that
// is not hashed from the identity: it stands for a life accumulating in
// Kamosféra, and it is where that connection will feed in. Until then it is
// a value to be set by hand.
export const DEFAULT_GROWTH = 0.85;

// Every field is a coefficient in the air layer. Ranges are deliberately
// narrow: the palette must stay related, the light stays single.
export function deviationFrom(identity, epoch = 0, growth = DEFAULT_GROWTH) {
  const r = stream(hashString(identity + '#' + epoch), 18);
  return {
    identity,
    epoch,
    growth,
    // Which of the made palettes, and how far the world drifts inside it.
    paletteIndex: Math.floor(r[0] * 11.999),
    paletteShift: lerp(-0.035, 0.035, r[1]),
    paletteLift: lerp(-0.05, 0.05, r[2]),
    lightAngle: r[3] * Math.PI * 2,         // one light, any bearing
    lightHeight: lerp(0.18, 0.55, r[4]),    // low sun, long soft light
    lightWarmth: lerp(-0.10, 0.12, r[5]),   // hue offset of the light only
    fogDensity: lerp(0.85, 1.45, r[6]),     // multiplier on view distance
    // Short on purpose. The fog has to close before the ground reaches the
    // geometric horizon, otherwise the far ground stacks up into a line at
    // eye level and the world grows an edge.
    // Far enough that three or four ridges stand between the walker and
    // the fog. A landscape read as layers needs layers to read.
    viewDistance: lerp(95, 220, r[7]),      // metres before fog closes
    windDir: r[8] * Math.PI * 2,
    windSpeed: lerp(0.4, 1.8, r[9]),
    grainScale: lerp(0.7, 2.2, r[10]),      // density of surface detail
    grainStrength: lerp(0.35, 1.0, r[11]),
    cloudCover: lerp(0.18, 0.42, r[12]),    // how much sky is taken
    // Clouds are deliberately smaller and lower than real ones. The fog
    // closes at a hundred-odd metres, and a cloud of honest size casts a
    // shadow far wider than that — the plain would simply dim as a whole
    // instead of having shade travel across it.
    cloudHeight: lerp(260, 620, r[13]),     // metres to the cloud plane
    cloudScale: lerp(0.0030, 0.0075, r[14]),// noise units per metre
    // Clouds ride far faster than the breeze on the ground. At walking
    // speed the shade would take minutes to cross the visible plain and
    // would read as the light simply changing.
    cloudDrift: lerp(3.5, 9.0, r[15]),      // multiplier on the wind
    shadowStrength: lerp(0.45, 0.85, r[16]),// how dark the shade falls
    sunAngle: lerp(7, 20, r[16]) * Math.PI / 180,  // radius of the disc
    // How far along a view direction the sky asks the ground whether it
    // exists. Not hashed: it is a tuning number, not a trait.
    skyProbe: 45,
  };
}

export const DEFAULT_IDENTITY = 'dreamer';

// --------------------------------------------------------------- palette
//
// Twelve palettes, each one chosen rather than computed. The hue wheel it
// replaces guaranteed variety and could not guarantee taste: some
// identities landed on combinations nobody would pick, and one of them
// the owner called frightening.
//
// Every palette keeps the same structure, which is the part that was
// right. The ground carries the dominant colour. The sky sits beside it,
// lighter and quieter, so the ground stays dominant. One warm light is
// the single thing allowed to contradict them. And the fog is barely a
// colour at all, because the fog is the Nothing and the Nothing has no
// opinion.
//
// Written as hue, saturation, lightness so the vector can shift a whole
// palette a little without ever leaving it.

const PALETTES = [
  { name: 'evening meadow',
    fog: [0.17, 0.10, 0.94], zenith: [0.42, 0.17, 0.68],
    groundHigh: [0.19, 0.33, 0.55], groundLow: [0.21, 0.45, 0.29],
    trace: [0.23, 0.42, 0.21], light: [0.09, 0.88, 0.67] },

  { name: 'dry heath',
    fog: [0.10, 0.12, 0.94], zenith: [0.56, 0.20, 0.72],
    groundHigh: [0.11, 0.40, 0.58], groundLow: [0.09, 0.46, 0.33],
    trace: [0.08, 0.44, 0.24], light: [0.05, 0.85, 0.62] },

  { name: 'cold moss',
    fog: [0.48, 0.07, 0.94], zenith: [0.55, 0.18, 0.72],
    groundHigh: [0.33, 0.28, 0.54], groundLow: [0.35, 0.42, 0.30],
    trace: [0.37, 0.40, 0.22], light: [0.12, 0.78, 0.74] },

  { name: 'rust plain',
    fog: [0.05, 0.10, 0.94], zenith: [0.76, 0.14, 0.70],
    groundHigh: [0.05, 0.42, 0.51], groundLow: [0.04, 0.50, 0.29],
    trace: [0.03, 0.48, 0.21], light: [0.08, 0.80, 0.79] },

  { name: 'lavender field',
    fog: [0.83, 0.08, 0.95], zenith: [0.92, 0.16, 0.74],
    groundHigh: [0.74, 0.24, 0.62], groundLow: [0.73, 0.24, 0.37],
    trace: [0.72, 0.26, 0.27], light: [0.11, 0.82, 0.72] },

  { name: 'salt flat',
    fog: [0.13, 0.09, 0.95], zenith: [0.55, 0.16, 0.76],
    groundHigh: [0.13, 0.26, 0.72], groundLow: [0.12, 0.30, 0.45],
    trace: [0.11, 0.32, 0.34], light: [0.11, 0.90, 0.79] },

  { name: 'forest floor',
    fog: [0.25, 0.06, 0.93], zenith: [0.28, 0.10, 0.66],
    groundHigh: [0.27, 0.30, 0.44], groundLow: [0.30, 0.32, 0.22],
    trace: [0.31, 0.30, 0.16], light: [0.10, 0.80, 0.64] },

  { name: 'copper steppe',
    fog: [0.09, 0.11, 0.94], zenith: [0.48, 0.22, 0.66],
    groundHigh: [0.07, 0.42, 0.53], groundLow: [0.06, 0.46, 0.30],
    trace: [0.05, 0.44, 0.22], light: [0.95, 0.72, 0.76] },

  { name: 'blue hour',
    fog: [0.60, 0.09, 0.94], zenith: [0.63, 0.28, 0.64],
    groundHigh: [0.60, 0.14, 0.56], groundLow: [0.61, 0.20, 0.32],
    trace: [0.62, 0.22, 0.24], light: [0.09, 0.62, 0.85] },

  { name: 'autumn bracken',
    fog: [0.11, 0.11, 0.94], zenith: [0.30, 0.14, 0.69],
    groundHigh: [0.08, 0.44, 0.53], groundLow: [0.07, 0.58, 0.29],
    trace: [0.06, 0.54, 0.21], light: [0.13, 0.88, 0.68] },

  { name: 'jade terrace',
    fog: [0.16, 0.10, 0.94], zenith: [0.15, 0.20, 0.73],
    groundHigh: [0.42, 0.24, 0.55], groundLow: [0.44, 0.34, 0.30],
    trace: [0.45, 0.34, 0.22], light: [0.06, 0.82, 0.63] },

  { name: 'ash and ember',
    fog: [0.75, 0.05, 0.94], zenith: [0.76, 0.06, 0.70],
    groundHigh: [0.78, 0.06, 0.55], groundLow: [0.79, 0.08, 0.31],
    trace: [0.80, 0.10, 0.23], light: [0.03, 0.78, 0.61] },
];

export const PALETTE_COUNT = PALETTES.length;

function hslToRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
  };
  return [f(0), f(8), f(4)];
}

// Returns sRGB triples. Shaders mix and output in this space directly.
export function paletteFrom(d) {
  const p = PALETTES[Math.max(0, Math.min(PALETTES.length - 1,
    Math.round(d.paletteIndex)))];
  const clamp01 = (v) => Math.max(0.02, Math.min(0.98, v));
  // A narrow drift around the chosen palette, never across the wheel.
  const tint = (c, warm) => hslToRgb(
    c[0] + d.paletteShift + (warm ? d.lightWarmth * 0.4 : 0),
    c[1],
    clamp01(c[2] + d.paletteLift));
  return {
    fog: tint(p.fog),
    zenith: tint(p.zenith),
    groundHigh: tint(p.groundHigh),
    groundLow: tint(p.groundLow),
    trace: tint(p.trace),
    light: tint(p.light, true),
  };
}

export function paletteName(d) {
  const i = Math.max(0, Math.min(PALETTES.length - 1, Math.round(d.paletteIndex)));
  return PALETTES[i].name;
}

export function lightDirection(d) {
  const y = d.lightHeight;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return [Math.cos(d.lightAngle) * r, y, Math.sin(d.lightAngle) * r];
}

// ----------------------------------------------------------------- party

// The ground answers to everyone standing on it at once, never to one
// person. Averaging is order-independent, so every client that knows who is
// present computes the same number without agreeing on anything else.
// With one player present, the mix is that player.
export function partyFrom(members) {
  if (!members || members.length === 0) return { growth: 0 };
  let growth = 0;
  for (const m of members) growth += m.growth || 0;
  return { growth: growth / members.length };
}
