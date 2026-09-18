// cover.js — the first thing in this world at human scale.
//
// Everything until now was hills and haze, and a hill with nothing beside
// it has no size: the eye cannot tell a ridge thirty metres away from one
// three hundred metres away. A blade of grass can, because everyone knows
// how big a blade of grass is.
//
// The rule that governs this file is the cost rule. Ground cover is the one
// planned element that can break it, because the obvious way to build it —
// blades per square metre of world — grows without limit. So the count is
// fixed. A lattice of cells rides with the camera and each cell holds one
// blade, placed by a hash of the cell's own world coordinates, which is
// what keeps the blades standing still while the lattice slides underneath.
// Two lattices, one fine and near, one coarse and far. Walk a kilometre and
// exactly as many blades are drawn as when you started.
//
// Air layer: no collision, ever. It reads the shared ground to stand on it
// and the shared wake to know whether it exists here at all.

import * as THREE from 'three';
import { WORLD_GLSL } from './world.js';
import { TRACE_GLSL, BLOOM_GLSL, WAKE_GLSL } from './traces.js';
import { REGION_GLSL } from './region.js';

// Two tiers. Cells are square, one blade to a cell, count fixed for ever.
//
// The near tier is dense and tiny, because that is the only place a blade
// does its job: giving the eye something it already knows the size of. The
// far tier is thin and thinning, and past it the ground's own grain
// carries on alone — scattering a few big blades over a distant hillside
// reads as conifers, not as cover.
const TIERS = [
  // Near blades have a middle row of vertices and can therefore bend. Far
  // ones are a few pixels tall and cannot show a bend, so they do not
  // carry the row that would let them — the whole difference in cost.
  { cells: 128, cellSize: 0.15, height: 0.26, width: 0.019, arched: true },
  { cells: 96, cellSize: 0.55, height: 0.34, width: 0.030, arched: false },
];

const VERT = /* glsl */`
attribute vec2 aCell;          // integer cell, relative to the lattice
uniform vec2 uOrigin;          // lattice origin, snapped to whole cells
uniform float uCellSize;
uniform float uBladeHeight;
uniform float uBladeWidth;
uniform float uRange;          // where this tier gives up
uniform float uNearFade;       // and where it starts, so tiers overlap
uniform float uPresenceCover;
uniform float uPartyCeiling;
uniform vec2 uWinRelief;
uniform float uGrowthCeiling;
uniform vec2 uGustOffset;
uniform float uWindDir;
uniform float uWindSpeed;
uniform vec3 uViewDir;
varying float vUp;
varying float vDist;
varying float vShade;

void main() {
  vec2 cell = uOrigin + aCell * uCellSize;

  // Hashed from the cell's world position, so a blade stands in the same
  // spot no matter where the walker is standing.
  int cx = int(floor(cell.x / uCellSize + 0.5));
  int cz = int(floor(cell.y / uCellSize + 0.5));
  uint h = dwHash2(cx, cz);

  // Grass grows in tufts with bare ground between them. Evenly spaced
  // blades read as spines on an animal, which is exactly what they looked
  // like. Four cells share a root, and some roots hold nothing at all.
  uint th = dwHash2(cx >> 1, cz >> 1);
  vec2 tuftJitter = vec2(float(th & 0xffffu) / 65535.0,
                         float((th >> 16) & 0xffffu) / 65535.0) - 0.5;
  vec2 tuft = vec2(float(cx >> 1), float(cz >> 1)) * uCellSize * 2.0
    + tuftJitter * uCellSize * 1.1;
  vec2 jitter = vec2(float(h & 0xffffu) / 65535.0,
                     float((h >> 16) & 0xffffu) / 65535.0) - 0.5;
  vec2 wxz = tuft + jitter * uCellSize * 0.7;

  float tuftAlive = step(float((th >> 24) & 0xffu) / 255.0, 0.90);

  vDist = distance(wxz, cameraPosition.xz);

  // How much of the world is here. Cover follows the walked line like the
  // colour does, with the landscape's wide wake underneath it.
  float woken = uGrowthCeiling * dwBloom(wxz);
  float broad = uGrowthCeiling * dwWake(wxz);
  float alive = max(smoothstep(0.13, 0.27, woken),
                    0.45 * smoothstep(0.10, 0.40, broad));

  float grow = uPresenceCover * alive * tuftAlive;
  grow *= 1.0 - smoothstep(uRange * 0.45, uRange, vDist);
  grow *= smoothstep(uNearFade * 0.4, uNearFade, vDist);

  // Half a disc of blades stands behind the walker's head. Collapsing
  // those buys the same picture for half the triangles, with a wide enough
  // margin that turning round never catches one appearing.
  vec2 toBlade = wxz - cameraPosition.xz;
  float facing = dot(normalize(toBlade + vec2(1e-5)),
                     normalize(uViewDir.xz + vec2(1e-5)));
  grow *= smoothstep(-0.62, -0.30, facing);

  // Leave before the expensive part. A collapsed blade still runs this
  // shader, and the ground it would have stood on costs seven gradient
  // noises to find — which is the whole reason to drop it here and not
  // after.
  if (grow <= 0.002) {
    vUp = 0.0; vDist = 0.0; vShade = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // Every blade is a different one, but only a little.
  float vary = 0.70 + 0.85 * float((h >> 8) & 0xffu) / 255.0;
  float lean = (float((h >> 20) & 0xffu) / 255.0 - 0.5) * 1.15;
  float height = uBladeHeight * vary * grow;

  float relief = smoothstep(uWinRelief.x, uWinRelief.y,
                            uPartyCeiling * dwWake(wxz));
  float ground = dwBaseHeight(wxz, relief) + dwRegionHeight(wxz)
    - dwTraceDepth(wxz);

  // Facing the camera, so every blade is worth its triangle.
  vec3 toEye = vec3(cameraPosition.x - wxz.x, 0.0, cameraPosition.z - wxz.y);
  vec3 right = normalize(vec3(-toEye.z, 0.0, toEye.x) + vec3(1e-5, 0.0, 0.0));

  vUp = position.y;
  vec3 world = vec3(wxz.x, ground, wxz.y);

  // The curve. Everything that bends the blade is proportional to this,
  // and it only means anything where the blade has a vertex partway up:
  // sampled at nothing but its own two ends, a curve is a straight line.
  // That is exactly what was wrong before — the blades leaned, but a lean
  // is not a bend.
  float bow = vUp * vUp;

  // Width narrows along the whole length rather than only at the tip.
  world += right * (position.x * uBladeWidth * vary * (1.0 - 0.50 * vUp));

  // It rises and tips over: at the top it has given up nearly a third of
  // its height to the arc, which is what a blade of grass does.
  world.y += height * (vUp - 0.30 * bow);
  world += right * (lean * height * bow);

  // One wind field, the same one the clouds and the mist ride. It bends
  // the blade along the same curve and leaves the root where it is.
  vec2 wind = dwWind(wxz, uGustOffset, uWindDir, uWindSpeed);
  world.xz += wind * bow * height * 0.40;

  // Pale at the tip, and never as dark at the root as the ground it stands
  // in — dark blades on a light surface read as marks, not as cover.
  vShade = 0.80 + 0.30 * vUp;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */`
uniform vec3 uFogColor;
uniform vec3 uGroundHigh;
uniform vec3 uGroundLow;
uniform float uFogDensity;
uniform float uViewDistance;
varying float vUp;
varying float vDist;
varying float vShade;

void main() {
  float away = vDist / max(uViewDistance, 1.0);

  // A shade lighter than the ground it stands on, so it reads as a layer
  // over the surface rather than as marks drawn on it.
  vec3 tint = mix(uGroundLow, uGroundHigh, vUp * 0.45 + 0.55);
  float value = vShade * mix(0.66, 1.0, smoothstep(0.0, 0.35, away));
  vec3 col = tint * value;

  // The same air as the ground, or the cover would float on top of it.
  vec3 distant = mix(uFogColor, uGroundHigh, 0.22);
  col = mix(col, distant, (1.0 - exp(-away * 2.4)) * 0.85);

  float density = 3.05 / uViewDistance * uFogDensity;
  float f = 1.0 - exp(-(vDist * density) * (vDist * density));

  gl_FragColor = vec4(mix(col, uFogColor, clamp(f, 0.0, 1.0)), 1.0);
}
`;

// An arched blade needs three rows of vertices: root, middle, tip. Two
// rows can only ever draw a straight line, however good the curve in the
// shader is. A straight blade is one row cheaper and is used where the
// blade is a few pixels tall and no bend would survive anyway.
function bladeGeometry(tier) {
  const geo = new THREE.InstancedBufferGeometry();
  const shape = tier.arched
    ? {
      pos: [
        -0.5, 0.00, 0.0,
        0.5, 0.00, 0.0,
        -0.30, 0.55, 0.0,
        0.30, 0.55, 0.0,
        0.0, 1.00, 0.0,
      ],
      idx: [0, 1, 2, 2, 1, 3, 2, 3, 4],
    }
    : {
      pos: [
        -0.5, 0.00, 0.0,
        0.5, 0.00, 0.0,
        -0.13, 1.00, 0.0,
        0.13, 1.00, 0.0,
      ],
      idx: [0, 1, 2, 2, 1, 3],
    };
  geo.setAttribute('position',
    new THREE.BufferAttribute(new Float32Array(shape.pos), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(shape.idx), 1));

  const n = tier.cells;
  const cells = new Float32Array(n * n * 2);
  let k = 0;
  const half = n / 2;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cells[k++] = i - half;
      cells[k++] = j - half;
    }
  }
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
  geo.instanceCount = n * n;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return geo;
}

class CoverTier {
  constructor(tier, uniformGroups) {
    this.tier = tier;
    const range = tier.cells * tier.cellSize * 0.5;
    this.uniforms = Object.assign(
      {
        uOrigin: { value: new THREE.Vector2() },
        uCellSize: { value: tier.cellSize },
        uBladeHeight: { value: tier.height },
        uBladeWidth: { value: tier.width },
        uRange: { value: range },
        uNearFade: { value: 0 },
      },
      ...uniformGroups,
    );

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: WORLD_GLSL + TRACE_GLSL + BLOOM_GLSL + WAKE_GLSL
        + REGION_GLSL + VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(bladeGeometry(tier), this.material);
    this.mesh.frustumCulled = false;
  }

  update(camX, camZ) {
    // Snapped to whole cells: the lattice slides in steps, so no blade ever
    // drifts across the ground.
    const s = this.tier.cellSize;
    this.uniforms.uOrigin.value.set(
      Math.round(camX / s) * s, Math.round(camZ / s) * s);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export class Cover {
  constructor(uniformGroups) {
    this.uniformGroups = uniformGroups;
    this.tiers = null;
  }

  // Not built until there is any, like everything else that grows.
  _construct(scene) {
    this.tiers = TIERS.map((t) => new CoverTier(t, this.uniformGroups));
    // The fine tier hands over to the coarse one rather than stopping.
    this.tiers[1].uniforms.uNearFade.value =
      this.tiers[0].uniforms.uRange.value * 0.55;
    for (const t of this.tiers) scene.add(t.mesh);
  }

  update(scene, camera, presence) {
    if (presence <= 0.002) {
      if (this.tiers) for (const t of this.tiers) t.mesh.visible = false;
      return;
    }
    if (!this.tiers) this._construct(scene);
    for (const t of this.tiers) {
      t.mesh.visible = true;
      t.update(camera.position.x, camera.position.z);
    }
  }

  get bladeCount() {
    return TIERS.reduce((n, t) => n + t.cells * t.cells, 0);
  }

  dispose() {
    if (this.tiers) for (const t of this.tiers) t.dispose();
  }
}
