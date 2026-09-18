// terrain.js — the ground, drawn as a radial disc that follows the camera.
//
// The mesh is a fixed number of vertices arranged in rings whose spacing
// grows with radius, so vertex density is roughly constant on screen. The
// disc is never moved through the world data: every frame each vertex is
// re-evaluated from the world function at its own world position. Nothing
// is baked, nothing accumulates, and one metre of world costs exactly what
// ten kilometres of world costs.
//
// The ground is the shared layer. What the personal layer may do here is
// change how it is lit and coloured — including the shade of a cloud that
// only this player can see — never where the surface is.
//
// Growth is not a dial on this shader, it is a place. Every pixel asks the
// bloom field how awake its own patch of ground is, so the world comes
// alive along the walked line and stays the Nothing everywhere else.

import * as THREE from 'three';
import { WORLD_GLSL } from './world.js';
import { TRACE_GLSL, BLOOM_GLSL, WAKE_GLSL } from './traces.js';
import { CLOUD_GLSL, MIST_SCALE, MIST_PERIOD } from './clouds.js';
import { REGION_GLSL } from './region.js';

const ANGULAR = 160;   // vertices around
const RINGS = 112;     // vertices outward
const FALLOFF = 0.021; // ring growth; smaller = flatter distribution

const VERT = /* glsl */`
attribute float aRadius;
uniform vec2 uCenter;
uniform float uMaxRadius;
uniform vec2 uMistOffset;
uniform float uPartyCeiling;   // the mix of everyone here, never one person
uniform vec2 uWinRelief;
varying vec3 vWorld;
varying float vMist;

void main() {
  vec2 wxz = uCenter + position.xz * (aRadius * uMaxRadius);

  // The mist that thins and thickens the fog is a slow, wide thing. Asking
  // for it once per vertex instead of once per pixel costs nothing to look
  // at and saves a gradient noise on every pixel of ground on screen.
  vMist = 0.86 + 0.28 * dwPerlin2p(
    wxz * ${MIST_SCALE.toFixed(4)} - uMistOffset, ${MIST_PERIOD});

  // Relief reads the wide wake, not the narrow bloom the colour uses. A
  // landscape wakes around a walker over hundreds of metres; sharing the
  // path's radius raised an embankment along the trail instead.
  float relief = smoothstep(uWinRelief.x, uWinRelief.y,
                            uPartyCeiling * dwWake(wxz));
  // Whatever law holds here. It is part of the shared ground and comes
  // through the party mix, exactly as relief does.
  float h = dwBaseHeight(wxz, relief) + dwRegionHeight(wxz) - dwTraceDepth(wxz);
  vWorld = vec3(wxz.x, h, wxz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const FRAG = /* glsl */`
uniform vec3 uFogColor;
uniform vec3 uGroundHigh;
uniform vec3 uGroundLow;
uniform vec3 uTraceTint;
uniform vec3 uLightColor;
uniform vec3 uLightDir;
uniform float uFogDensity;
uniform float uViewDistance;
uniform float uGrainScale;
uniform float uGrainStrength;
uniform float uGrowthCeiling;      // how much world this person can wake
uniform vec2 uWinCloudShadows;     // the window that element fades in over
uniform float uOvrCloudShadows;    // >= 0 forces it, for tuning by hand
varying vec3 vWorld;
varying float vMist;

void main() {
  // Normals from the rasterised surface: one height sample per vertex is
  // enough, the derivative gives us the rest.
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;

  float dist = length(vWorld - cameraPosition);
  float near = 1.0 - smoothstep(6.0, 38.0, dist);
  float away = dist / max(uViewDistance, 1.0);

  float resolved = clamp(dwTraceDepth(vWorld.xz) / max(uTraceRef, 1e-4),
                         0.0, 1.0);

  // Two answers to "how much of the world is here": the narrow one along
  // the walked line, and the wide one for the landscape around it. Colour
  // follows the line, but the hills are not left looking dead.
  float woken = uGrowthCeiling * dwBloom(vWorld.xz);
  float broad = uGrowthCeiling * dwWake(vWorld.xz);
  float alive = max(smoothstep(0.13, 0.27, woken),
                    0.45 * smoothstep(0.10, 0.40, broad));

  float grain = 0.0;
  if (near > 0.01 && uGrainStrength > 0.01) {
    grain = dwFbm2(vWorld.xz * uGrainScale * 0.55, 2);
  }
  float g = grain * uGrainStrength * near * alive;

  float presShadow = uOvrCloudShadows >= 0.0 ? uOvrCloudShadows
    : smoothstep(uWinCloudShadows.x, uWinCloudShadows.y, woken);
  float shade = dwCloudShadow(vWorld.xz, uLightDir, presShadow);

  // Shape is carried by lightness, not by hue. A wide range from the face
  // turned towards the light to the one turned away is the whole reason a
  // ridge can be told from the ground behind it.
  float lam = dot(n, uLightDir) * 0.5 + 0.5;
  float value = 0.40 + 0.66 * lam;
  value *= 1.0 - 0.34 * shade;

  // Near ground darker than far ground, so the eye reads depth before it
  // reads colour.
  // Not quite as dark underfoot as it was: the gaps between tufts of cover
  // were reading as bare earth rather than as ground with grass on it.
  value *= mix(0.74, 1.0, smoothstep(0.0, 0.35, away));

  vec3 tint = mix(uGroundHigh, uGroundLow, clamp(0.5 + g * 0.85, 0.0, 1.0));
  tint = mix(tint, uTraceTint, resolved * 0.5 * alive);
  vec3 col = tint * value;

  // Where nothing has woken there is no ground worth the name.
  col = mix(uFogColor * 0.93, col, alive);

  // Aerial perspective. Each ridge paler than the one in front of it,
  // which is what makes a landscape legible — and it is one mix.
  vec3 distant = mix(uFogColor, uGroundHigh, 0.22);
  col = mix(col, distant, (1.0 - exp(-away * 2.4)) * 0.85);

  // Fog is the horizon, and the one wind field drifts it.
  float density = 3.05 / uViewDistance * uFogDensity * vMist;
  float f = 1.0 - exp(-(dist * density) * (dist * density));

  gl_FragColor = vec4(mix(col, uFogColor, clamp(f, 0.0, 1.0)), 1.0);
}
`;

function buildDisc() {
  const verts = (RINGS + 1) * ANGULAR;
  const position = new Float32Array(verts * 3);
  const radius = new Float32Array(verts);

  const norm = Math.exp(FALLOFF * RINGS) - 1;
  for (let j = 0; j <= RINGS; j++) {
    const r = (Math.exp(FALLOFF * j) - 1) / norm;
    for (let i = 0; i < ANGULAR; i++) {
      const a = (i / ANGULAR) * Math.PI * 2;
      const k = j * ANGULAR + i;
      position[k * 3] = Math.cos(a);
      position[k * 3 + 1] = 0;
      position[k * 3 + 2] = Math.sin(a);
      radius[k] = r;
    }
  }

  const index = new Uint32Array(RINGS * ANGULAR * 6);
  let o = 0;
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < ANGULAR; i++) {
      const i2 = (i + 1) % ANGULAR;
      const a = j * ANGULAR + i;
      const b = j * ANGULAR + i2;
      const c = (j + 1) * ANGULAR + i;
      const d = (j + 1) * ANGULAR + i2;
      index[o++] = a; index[o++] = c; index[o++] = d;
      index[o++] = a; index[o++] = d; index[o++] = b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return geo;
}

export class Terrain {
  constructor(uniformGroups) {
    this.uniforms = Object.assign(
      {
        uCenter: { value: new THREE.Vector2(0, 0) },
        uMaxRadius: { value: 260 },
      },
      ...uniformGroups,
    );

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: WORLD_GLSL + TRACE_GLSL + BLOOM_GLSL + WAKE_GLSL
        + REGION_GLSL + CLOUD_GLSL + VERT,
      fragmentShader: WORLD_GLSL + TRACE_GLSL + BLOOM_GLSL + WAKE_GLSL
        + CLOUD_GLSL + FRAG,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(buildDisc(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
  }

  update(camX, camZ, viewDistance) {
    this.uniforms.uCenter.value.set(camX, camZ);
    this.uniforms.uMaxRadius.value = viewDistance * 1.15;
  }

  get triangleCount() { return RINGS * ANGULAR * 2; }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
