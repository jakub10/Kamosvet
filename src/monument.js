// monument.js — the one enormous thing.
//
// Nothing produces awe as cheaply as size, and nothing else here breaks the
// skyline at all. Silhouette is a setting with nothing to apply to until
// something stands against the sky.
//
// It is not placed. A coarse lattice covers the world; a hash decides which
// cells hold something, where in the cell it stands, and how tall and wide
// it is. The CPU picks the nearest one and hands the shader four numbers;
// the shader tests each view ray against it analytically. No geometry, no
// draw call of its own, and the cost is the pixels it covers.
//
// It belongs to the world rather than to the person, so its position comes
// from the world hash and its presence from the party ceiling — everyone
// standing here sees the same thing in the same place.

import { hash2, unitFloat } from './world.js';

const CELL = 2400;         // metres between candidate sites
const OCCUPANCY = 0.42;    // how many cells hold anything
// Nothing this size belongs beside a footpath. Close up it stopped being
// a landmark and became a wall; on the horizon it is somewhere to go.
const MIN_RANGE = 420;

// Returns the nearest monument to a point, or null.
export function nearestMonument(x, z) {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let best = null;
  let bestDist = Infinity;

  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const gx = cx + i, gz = cz + j;
      const h = hash2(gx, gz);
      if (unitFloat(h) > OCCUPANCY) continue;

      // Four more numbers from the same cell: where it stands, and its size.
      const jx = unitFloat(hash2(gx + 7919, gz));
      const jz = unitFloat(hash2(gx, gz + 104729));
      const hh = unitFloat(hash2(gx + 31, gz + 17));
      const ww = unitFloat(hash2(gx - 13, gz + 91));

      const px = (gx + 0.15 + jx * 0.7) * CELL;
      const pz = (gz + 0.15 + jz * 0.7) * CELL;
      const dist = Math.hypot(px - x, pz - z);
      if (dist < MIN_RANGE || dist >= bestDist) continue;

      bestDist = dist;
      best = {
        x: px,
        z: pz,
        dist,
        // Which of the four silhouettes stands here. Nothing else about
        // the shape is stored: at four hundred metres and beyond the
        // outline is the entire effect, which is what makes this cheap.
        kind: hash2(gx + 5, gz - 3) & 3,
        height: 180 + hh * 420,      // metres
        halfWidth: 30 + ww * 90,     // metres
        taper: 0.25 + hh * 0.5,      // how much it narrows towards the top
      };
    }
  }
  return best;
}

export function makeMonumentUniforms() {
  return {
    uMonumentPos: { value: [0, 0] },
    uMonumentShape: { value: [0, 0, 0] },  // halfWidth, height, taper
    uMonumentKind: { value: 0 },
    uPresenceMonument: { value: 0 },
  };
}

export function updateMonumentUniforms(u, x, z, presence) {
  const m = nearestMonument(x, z);
  if (!m) {
    u.uPresenceMonument.value = 0;
    return null;
  }
  u.uMonumentPos.value[0] = m.x;
  u.uMonumentPos.value[1] = m.z;
  u.uMonumentShape.value[0] = m.halfWidth;
  u.uMonumentShape.value[1] = m.height;
  u.uMonumentShape.value[2] = m.taper;
  u.uMonumentKind.value = m.kind;
  u.uPresenceMonument.value = presence;
  return m;
}

export const MONUMENT_GLSL = /* glsl */`
uniform vec2 uMonumentPos;
uniform vec3 uMonumentShape;   // halfW width, height, taper
uniform float uMonumentKind;
uniform float uPresenceMonument;

// How much of this view direction is monument, 0 or 1 with an edge between,
// and how far up it the ray struck. The ray is cast onto the vertical plane
// the thing stands on, which is one divide and two dot products — the whole
// silhouette costs less than a single octave of noise.
//
// Four outlines and nothing else: no detail, no geometry, no second draw.
// A slab was correct and said nothing; these are meant to be recognised
// from a kilometre away and never approached closely enough to disappoint.
float dwMonument(vec3 d, vec3 eye, out float rise) {
  rise = 0.0;
  if (uPresenceMonument <= 0.002) return 0.0;

  vec2 toIt = uMonumentPos - eye.xz;
  float range = length(toIt);
  if (range < 1.0) return 0.0;
  vec2 ahead = toIt / range;
  vec2 across = vec2(-ahead.y, ahead.x);

  float forward = dot(d.xz, ahead);
  if (forward <= 0.02) return 0.0;          // behind us, or edge on

  float t = range / forward;
  float sideways = t * dot(d.xz, across);
  float up = t * d.y;                       // metres above eye at the plane

  float halfW = uMonumentShape.x;
  float tall = uMonumentShape.y;
  rise = clamp(up / tall, 0.0, 1.0);

  // One pixel or so, in the units this is measured in.
  float e = max(fwidth(sideways), tall * 0.002);
  float ev = max(fwidth(up), tall * 0.002);
  float foot = smoothstep(-ev, ev, up);
  // Never smoothstep with the edges the wrong way round: it is undefined
  // in GLSL and at least one driver here answers it with nonsense.
  float cap = 1.0 - smoothstep(tall - ev, tall + ev, up);

  int kind = int(uMonumentKind + 0.5);
  float inside = 0.0;

  if (kind == 0) {
    // A spire. Narrows as it rises and stops.
    float w = halfW * (1.0 - uMonumentShape.z * rise);
    inside = (1.0 - smoothstep(w - e, w + e, abs(sideways))) * foot * cap;

  } else if (kind == 1) {
    // A door as tall as a tower: a slab with an opening cut out of its
    // foot, and the opening is most of the height.
    float body = (1.0 - smoothstep(halfW - e, halfW + e, abs(sideways)))
      * foot * cap;
    float openHigh = tall * 0.66;
    float openHalf = halfW * 0.55;
    float arc = clamp(up / openHigh, 0.0, 1.0);
    float mouth = openHalf * sqrt(max(0.0, 1.0 - arc * arc));
    float hole = (1.0 - smoothstep(mouth - e, mouth + e, abs(sideways)))
      * (1.0 - smoothstep(openHigh - ev, openHigh + ev, up));
    inside = body * (1.0 - hole);

  } else if (kind == 2) {
    // A staircase that ends in the air. Each step is wider than the one
    // below it, and the top one leads nowhere.
    float steps = 7.0;
    float n = floor(clamp(up, 0.0, tall - 0.001) / (tall / steps));
    float reach = halfW * (2.0 * (n + 1.0) / steps - 1.0);
    inside = smoothstep(-halfW - e, -halfW + e, sideways)
      * (1.0 - smoothstep(reach - e, reach + e, sideways)) * foot * cap;

  } else {
    // A trunk whose top is not visible. There is no cap: it goes up out
    // of the sky and the eye never finds the end of it.
    float w = halfW * 0.45 * (1.0 - 0.2 * rise);
    inside = (1.0 - smoothstep(w - e, w + e, abs(sideways))) * foot;
  }

  return clamp(inside, 0.0, 1.0) * uPresenceMonument;
}
`;
