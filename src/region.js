// region.js — where one law of reality stops holding.
//
// Until now every place in this world looked like every other place. A
// walker had no reason to prefer one direction over another and nothing to
// remember a location by, and that was the largest thing still wrong with
// it — larger than any shading fix.
//
// So the world is divided. A coarse lattice covers it, a hash decides what
// holds in each cell, and inside a cell that law holds without exception.
// At the moment there are two states: the bowl, and nothing at all.
//
// The bowl is the horizon refusing to behave. The ground lifts as it goes
// away from the middle of the region, so the place has a floor and the
// walker stands inside it rather than on an endless plain. Past the rim it
// falls back to the shared ground, which is what lets the next region be
// something else.
//
// This touches the surface, so it is the shared layer and it goes through
// the party mix exactly as relief does. Two people in the same bowl stand
// on the same slope or the ground is not shared at all.
//
// The bowl is not the point. The point is that places stop being
// interchangeable.
//
// THREE PLACES have to add this term, and they have to agree exactly:
// the terrain's vertex shader, the cover's vertex shader, and
// groundHeightAt() in main.js, which is what the body walks on. Miss the
// last one and the world looks perfect while the walker stands forty
// metres under it — which is precisely what happened the first time.

import { hash2 } from './world.js';

export const DEFAULT_REGION = {
  // Small enough that the rim falls inside the fog. A bowl a walker
  // cannot see the far side of is not a bowl, it is a hill.
  cell: 440.0,     // metres across a region
  amplitude: 42.0, // metres the rim stands above the middle
};

// Where the rim sits, as a fraction of the region's radius, and where the
// law lets go. The rim has to fall inside the fade or the edge of the
// region would cut the rim off flat.
const RIM = 0.62;
const LETGO = 0.68;

// Which law holds in the cell containing a point. Two states for now: the
// hash's low bit says bowl or nothing.
export function lawAt(x, z, params = DEFAULT_REGION) {
  const cx = Math.floor(x / params.cell);
  const cz = Math.floor(z / params.cell);
  return (hash2(cx, cz) & 1) === 0 ? 'bowl' : 'none';
}

// Metres the region adds to the shared ground. `strength` is the party
// mix through the law's presence window — never one person's own vector.
export function regionHeight(x, z, strength, params = DEFAULT_REGION) {
  if (strength <= 0.002) return 0;
  const cx = Math.floor(x / params.cell);
  const cz = Math.floor(z / params.cell);
  if ((hash2(cx, cz) & 1) !== 0) return 0;

  const centreX = (cx + 0.5) * params.cell;
  const centreZ = (cz + 0.5) * params.cell;
  const radius = params.cell * 0.5;
  const r = Math.hypot(x - centreX, z - centreZ) / radius;

  const t = Math.min(1, r / RIM);
  const profile = t * t;
  const s = Math.min(1, Math.max(0, (1.0 - r) / (1.0 - LETGO)));
  const fade = s * s * (3 - 2 * s);
  return params.amplitude * profile * fade * strength;
}

export function makeRegionUniforms(params = DEFAULT_REGION) {
  return {
    uRegionCell: { value: params.cell },
    uRegionAmp: { value: params.amplitude },
    uLawStrength: { value: 0 },
  };
}

export function applyRegionToUniforms(u, params, strength) {
  u.uRegionCell.value = params.cell;
  u.uRegionAmp.value = params.amplitude;
  u.uLawStrength.value = strength;
}

// The GLSL twin. Read by every shader that needs to know where the ground
// is: the terrain, and anything standing on it.
export const REGION_GLSL = /* glsl */`
uniform float uRegionCell;
uniform float uRegionAmp;
uniform float uLawStrength;

float dwRegionHeight(vec2 p) {
  if (uLawStrength <= 0.002) return 0.0;

  vec2 cell = floor(p / uRegionCell);
  if ((dwHash2(int(cell.x), int(cell.y)) & 1u) != 0u) return 0.0;

  vec2 centre = (cell + 0.5) * uRegionCell;
  float radius = uRegionCell * 0.5;
  float r = length(p - centre) / radius;

  float t = min(1.0, r / ${RIM});
  float profile = t * t;

  // Written out rather than handed to smoothstep with its edges the wrong
  // way round. That is undefined behaviour in GLSL, and this driver
  // answers it with values far outside nought to one — which threw the
  // ground clean out from under the walker. It is also the twin of the JS
  // above, line for line, which is the whole point of writing both.
  float s = clamp((1.0 - r) / (1.0 - ${LETGO}), 0.0, 1.0);
  float fade = s * s * (3.0 - 2.0 * s);

  return uRegionAmp * profile * fade * uLawStrength;
}
`;
