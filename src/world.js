// world.js — the definition of the world itself.
//
// Everything here is a pure deterministic function of position and phase.
// No globals, no renderer state, no randomness, and no raw clock: time
// arrives already wrapped into a phase (see clock.js). The same inputs must
// give the same output on any machine, so that a server and two clients can
// later agree without exchanging geometry.
//
// HARD RULE (see dream-world-brief.md): the personal deviation vector must
// never reach baseHeight(). The ground is shared. What may shape the ground
// is the *party* deviation — the mix of everyone present, which both sides
// compute identically. Everything personal belongs to the air layer:
// colour, light, fog, wind, cloud, grain.
//
// The GLSL half of this file is kept next to the JS half on purpose. If one
// changes the other must change with it, or CPU collision and GPU display
// will drift apart.

// ---------------------------------------------------------------- hashing

// 32-bit integer hash. Bit-identical in JS and in GLSL ES 3.00.
export function hash1(x) {
  x = x >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function hash2(xi, yi) {
  return hash1((Math.imul(xi >>> 0, 0x9e3779b9) ^ hash1(yi >>> 0)) >>> 0);
}

// Unit float in [0,1) from a hash.
export function unitFloat(h) {
  return (h >>> 8) * (1.0 / 16777216.0);
}

function wrapInt(v, period) {
  const r = v % period;
  return r < 0 ? r + period : r;
}

// ------------------------------------------------------------------ noise

const S = 0.7071067811865476;
const GRAD8 = [
  [1, 0], [S, S], [0, 1], [-S, S],
  [-1, 0], [-S, -S], [0, -1], [S, -S],
];

function gradientNoise(x, y, period) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

  let x0 = ix, y0 = iy, x1 = ix + 1, y1 = iy + 1;
  if (period > 0) {
    x0 = wrapInt(x0, period); y0 = wrapInt(y0, period);
    x1 = wrapInt(x1, period); y1 = wrapInt(y1, period);
  }

  const g00 = GRAD8[hash2(x0, y0) & 7];
  const g10 = GRAD8[hash2(x1, y0) & 7];
  const g01 = GRAD8[hash2(x0, y1) & 7];
  const g11 = GRAD8[hash2(x1, y1) & 7];

  const a = g00[0] * fx + g00[1] * fy;
  const b = g10[0] * (fx - 1) + g10[1] * fy;
  const c = g01[0] * fx + g01[1] * (fy - 1);
  const d = g11[0] * (fx - 1) + g11[1] * (fy - 1);

  const ab = a + ux * (b - a);
  const cd = c + ux * (d - c);
  return (ab + uy * (cd - ab)) * 1.4142135;
}

// Gradient (Perlin) noise, roughly in [-1,1].
export function perlin2(x, y) {
  return gradientNoise(x, y, 0);
}

// The same noise, but repeating every `period` lattice cells. Anything a
// phase or a drift offset is added to has to use this one: it is what lets
// time run for ever without the pattern ever jumping.
export function perlin2p(x, y, period) {
  return gradientNoise(x, y, period);
}

export function fbm2(x, y, octaves) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin2(x, y);
    norm += amp;
    x *= 2.03; y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

// Periodic fbm. Lacunarity is exactly 2 so every octave's period stays a
// whole number of lattice cells.
export function fbm2p(x, y, octaves, period) {
  let sum = 0, amp = 0.5, norm = 0, per = period;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin2p(x, y, per);
    norm += amp;
    x *= 2; y *= 2; per *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

// ------------------------------------------------------------- base world

// Lattice periods for the time-driven terms. Large enough that the repeat
// is never seen, small enough that a 32-bit float carries the phase.
export const BREATH_PERIOD = 512;
export const GUST_PERIOD = 256;

// The shared ground. Deliberately quiet: a wide swell you feel rather than
// see, and a fine roll that keeps the surface from reading as a plane.
// Tunable at runtime, but the same values must hold for every player.
export const DEFAULT_BASE = {
  swellAmp: 2.2,      // metres, over hundreds of metres — latent relief
  swellScale: 420.0,  // metres per swell period
  reliefGain: 4.0,    // how far the party deviation can wake the swell
  rollAmp: 0.35,      // metres, underfoot
  rollScale: 26.0,    // metres per roll period
  // Relief: the shape the ground takes once it is awake. Big enough to
  // break a skyline, because flat shading on a flat plain has nothing to
  // read. Woken by the party mix, never by one person.
  // Pronounced enough, and close enough together, that several ridges fall
  // inside the fog at once. One distant swell cannot overlap anything.
  reliefAmp: 18.0,    // metres
  reliefScale: 85.0,  // metres per hill
  // The breath is a shared, time-varying term. It reads the world clock,
  // so both sides of a future connection agree on it.
  breathAmp: 0.0,     // metres, very slow shared drift
  breathRate: 0.010,  // noise units per second
};

// `relief` is 0..1 and says how far the ground here has woken. It comes
// from the walked bloom and the party mix, both shared, so two people
// always stand on the same shape. Nothing personal reaches this function.
export function baseHeight(x, z, breathPhase, B = DEFAULT_BASE, relief = 0) {
  // The swell sits at the edge of perception and relief is what raises it.
  // The ground never gains new shapes; it only wakes the ones asleep in it.
  const swell = B.swellAmp * (1 + B.reliefGain * relief);

  let h = 0;
  h += swell * perlin2(x / B.swellScale + 11.3, z / B.swellScale - 4.7);
  h += B.rollAmp * fbm2(x / B.rollScale, z / B.rollScale, 3);
  h += B.breathAmp * perlin2p(x * 0.004 + breathPhase, z * 0.004, BREATH_PERIOD);
  h += relief * B.reliefAmp
    * fbm2(x / B.reliefScale + 4.1, z / B.reliefScale - 8.3, 3);
  return h;
}

// ------------------------------------------------------------------- wind

// One wind field drives every moving thing. Direction and speed are part of
// the personal (air) layer, so this takes them as arguments; the gust offset
// comes pre-wrapped from clock.js.
export function windAt(x, z, gustOffset, dirRad, speed) {
  const dx = Math.cos(dirRad), dz = Math.sin(dirRad);
  const gust = 0.65 + 0.35 * perlin2p(
    x * 0.006 - gustOffset[0],
    z * 0.006 - gustOffset[1],
    GUST_PERIOD,
  );
  return { x: dx * speed * gust, z: dz * speed * gust };
}

// -------------------------------------------------------------- GLSL twin

// Included by every shader that needs the world. Uniform names starting with
// uB are the shared base; anything personal is passed in by the caller.
export const WORLD_GLSL = /* glsl */`
uniform float uBSwellAmp;
uniform float uBSwellScale;
uniform float uBReliefGain;
uniform float uBRollAmp;
uniform float uBRollScale;
uniform float uBBreathAmp;
uniform float uBReliefAmp;
uniform float uBReliefScale;
uniform float uBreathPhase;

uint dwHash1(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

uint dwHash2(int xi, int yi) {
  return dwHash1(uint(xi) * 0x9e3779b9u ^ dwHash1(uint(yi)));
}

const vec2 DW_GRAD8[8] = vec2[8](
  vec2( 1.0, 0.0), vec2( 0.7071067811865476,  0.7071067811865476),
  vec2( 0.0, 1.0), vec2(-0.7071067811865476,  0.7071067811865476),
  vec2(-1.0, 0.0), vec2(-0.7071067811865476, -0.7071067811865476),
  vec2( 0.0,-1.0), vec2( 0.7071067811865476, -0.7071067811865476)
);

int dwWrapInt(int v, int period) {
  int r = v % period;
  return r < 0 ? r + period : r;
}

float dwGradientNoise(vec2 p, int period) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  int x0 = int(i.x), y0 = int(i.y);
  int x1 = x0 + 1, y1 = y0 + 1;
  if (period > 0) {
    x0 = dwWrapInt(x0, period); y0 = dwWrapInt(y0, period);
    x1 = dwWrapInt(x1, period); y1 = dwWrapInt(y1, period);
  }

  vec2 g00 = DW_GRAD8[dwHash2(x0, y0) & 7u];
  vec2 g10 = DW_GRAD8[dwHash2(x1, y0) & 7u];
  vec2 g01 = DW_GRAD8[dwHash2(x0, y1) & 7u];
  vec2 g11 = DW_GRAD8[dwHash2(x1, y1) & 7u];

  float a = dot(g00, f);
  float b = dot(g10, f - vec2(1.0, 0.0));
  float c = dot(g01, f - vec2(0.0, 1.0));
  float d = dot(g11, f - vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142135;
}

float dwPerlin2(vec2 p) { return dwGradientNoise(p, 0); }

float dwPerlin2p(vec2 p, int period) { return dwGradientNoise(p, period); }

float dwFbm2(vec2 p, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * dwPerlin2(p);
    norm += amp;
    p *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

float dwFbm2p(vec2 p, int octaves, int period) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  int per = period;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * dwPerlin2p(p, per);
    norm += amp;
    p *= 2.0;
    per *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

// Shared ground. Never add a personal term here — only the party mix.
float dwBaseHeight(vec2 p, float relief) {
  float swell = uBSwellAmp * (1.0 + uBReliefGain * relief);
  float h = 0.0;
  h += swell * dwPerlin2(vec2(p.x / uBSwellScale + 11.3, p.y / uBSwellScale - 4.7));
  h += uBRollAmp * dwFbm2(p / uBRollScale, 3);
  h += uBBreathAmp * dwPerlin2p(vec2(p.x * 0.004 + uBreathPhase, p.y * 0.004), 512);
  h += relief * uBReliefAmp
    * dwFbm2(vec2(p.x / uBReliefScale + 4.1, p.y / uBReliefScale - 8.3), 3);
  return h;
}

vec2 dwWind(vec2 p, vec2 gustOffset, float dirRad, float speed) {
  vec2 d = vec2(cos(dirRad), sin(dirRad));
  float gust = 0.65 + 0.35 * dwPerlin2p(p * 0.006 - gustOffset, 256);
  return d * speed * gust;
}
`;

// Uniform block matching WORLD_GLSL. One instance is shared by every shader
// so the base world cannot diverge between them.
export function makeWorldUniforms(B = DEFAULT_BASE) {
  return {
    uBSwellAmp: { value: B.swellAmp },
    uBSwellScale: { value: B.swellScale },
    uBReliefGain: { value: B.reliefGain },
    uBRollAmp: { value: B.rollAmp },
    uBRollScale: { value: B.rollScale },
    uBBreathAmp: { value: B.breathAmp },
    uBReliefAmp: { value: B.reliefAmp },
    uBReliefScale: { value: B.reliefScale },
    uBreathPhase: { value: 0 },
  };
}

export function applyBaseToUniforms(u, B) {
  u.uBSwellAmp.value = B.swellAmp;
  u.uBSwellScale.value = B.swellScale;
  u.uBReliefGain.value = B.reliefGain;
  u.uBRollAmp.value = B.rollAmp;
  u.uBRollScale.value = B.rollScale;
  u.uBBreathAmp.value = B.breathAmp;
  u.uBReliefAmp.value = B.reliefAmp;
  u.uBReliefScale.value = B.reliefScale;
}
