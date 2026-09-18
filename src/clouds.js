// clouds.js — one cloud field, read twice.
//
// The clouds are a density function on a horizontal plane. The sky shader
// asks what is above by intersecting the view ray with that plane; the
// ground shader asks what shade falls on it by walking from the ground
// towards the light until it reaches the same plane. Both read the same
// function, so the shadow on the plain belongs to the cloud overhead.
//
// Nothing is modelled and nothing is placed. Cost is one noise evaluation
// per pixel that needs it, which makes it screen area, not world size.
//
// Clouds are the air layer: cover, drift and colour come from the player's
// own deviation vector. Two players standing together may see different
// weather; they still stand on the same ground.

import { GUST_PERIOD } from './world.js';
import { driftOffset } from './clock.js';

// Lattice period of the cloud field. The pattern repeats every 256 cells,
// which at the default scale is hundreds of kilometres — far past the fog —
// and it is what lets the field drift for ever without a seam.
export const CLOUD_PERIOD = 256;

export const CLOUD_GLSL = /* glsl */`
uniform float uCloudHeight;
uniform float uCloudScale;
uniform float uCloudCover;
uniform float uCloudSoftness;
uniform vec2  uCloudOffset;
uniform float uPresenceClouds;
uniform float uShadowStrength;

// Density in 0..1 at a point on the cloud plane, in metres. The octave
// count is a caller's choice because it is the single most expensive thing
// in this world: each octave is a gradient noise, and a gradient noise is
// two dozen integer operations on every pixel that asks for one.
float dwCloudFieldAt(vec2 metres, int octaves) {
  vec2 s = metres * uCloudScale + uCloudOffset;
  float n = dwFbm2p(s, octaves, ${CLOUD_PERIOD}) * 0.5 + 0.5;
  float edge = 1.0 - uCloudCover;
  return smoothstep(edge, edge + uCloudSoftness, n);
}

float dwCloudField(vec2 metres) { return dwCloudFieldAt(metres, 4); }

// Shade falling on a ground point: walk towards the light until the cloud
// plane, and ask the same field what is there. Presence is passed in rather
// than read from a uniform, because on the ground it varies from place to
// place — shade falls only where the world has been woken.
float dwCloudShadow(vec2 groundXZ, vec3 lightDir, float presence) {
  float amount = presence * uShadowStrength;
  if (amount <= 0.002) return 0.0;
  float up = max(lightDir.y, 0.12);
  vec2 hit = groundXZ + lightDir.xz * (uCloudHeight / up);
  // Two octaves. Shade on the ground is soft and enormous; the fine detail
  // of the cloud above it never survives the trip down.
  return dwCloudFieldAt(hit, 2) * amount;
}
`;

export function makeCloudUniforms() {
  return {
    uCloudHeight: { value: 420 },
    uCloudScale: { value: 0.0048 },
    uCloudCover: { value: 0.32 },
    uCloudSoftness: { value: 0.30 },
    uCloudOffset: { value: [0, 0] },
    uPresenceClouds: { value: 0 },
    uShadowStrength: { value: 0.7 },
  };
}

// Called once a frame. The drift comes from the one wind field, wrapped
// into the field's own period on the CPU so the GPU never sees a large
// number and the pattern never jumps.
export function updateCloudUniforms(u, dev, presence, seconds) {
  u.uCloudHeight.value = dev.cloudHeight;
  u.uCloudScale.value = dev.cloudScale;
  u.uCloudCover.value = dev.cloudCover;
  u.uShadowStrength.value = dev.shadowStrength;
  u.uPresenceClouds.value = presence.clouds;

  const drift = driftOffset(
    seconds, dev.windDir, dev.windSpeed * dev.cloudDrift,
    dev.cloudScale, CLOUD_PERIOD,
  );
  u.uCloudOffset.value[0] = drift[0];
  u.uCloudOffset.value[1] = drift[1];
}

// The mist that thickens and thins the fog rides the same wind, one scale
// coarser, so the whole air layer moves as one thing.
export const MIST_SCALE = 0.010;
export const MIST_PERIOD = GUST_PERIOD;

export function mistOffset(seconds, dev) {
  return driftOffset(
    seconds, dev.windDir, dev.windSpeed * 0.35, MIST_SCALE, MIST_PERIOD,
  );
}
