// sky.js — quiet, and only there over places that exist.
//
// One soft gradient and one enormous disc. It had flat bands with hard
// edges and they read as stripes: a sky that competes with the ground for
// attention takes the landscape's job away from it. The only hard edges
// left up here are the ones that belong to an actual silhouette — the disc
// of light, the clouds, and the monument.
//
// The sky is also not everywhere. Each direction asks the bloom field about
// the ground a short way along it, so the sky opens over the walked line
// and stays shut over the Nothing. Straight up it asks about the ground
// underfoot, because that is the ground that direction belongs to.

import * as THREE from 'three';
import { WORLD_GLSL } from './world.js';
import { BLOOM_GLSL } from './traces.js';
import { CLOUD_GLSL } from './clouds.js';
import { MONUMENT_GLSL } from './monument.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */`
uniform vec3 uFogColor;
uniform vec3 uZenith;
uniform vec3 uGroundLow;
uniform vec3 uLightColor;
uniform vec3 uLightDir;
uniform float uFogDensity;
uniform float uViewDistance;
uniform float uGrowthCeiling;
uniform vec2 uWinSky;
uniform float uOvrSky;
uniform vec2 uWinClouds;
uniform float uOvrClouds;
uniform float uSkyProbe;    // metres along the view direction to ask about
uniform float uSunSize;     // cosine of the disc's angular radius
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);

  vec2 flatDir = d.xz;
  float len = max(length(flatDir), 1e-4);
  vec2 probe = cameraPosition.xz + (flatDir / len) * uSkyProbe;
  float overhead = clamp(d.y * 1.8, 0.0, 1.0);
  float woken = mix(dwBloom(probe), dwBloom(cameraPosition.xz), overhead);
  float local = uGrowthCeiling * woken;

  float presSky = uOvrSky >= 0.0 ? uOvrSky
    : smoothstep(uWinSky.x, uWinSky.y, local);
  float presClouds = uOvrClouds >= 0.0 ? uOvrClouds
    : smoothstep(uWinClouds.x, uWinClouds.y, local);

  // With no sky there is only the Nothing, and the Nothing is the same in
  // every direction.
  vec3 col = uFogColor;

  // One ramp, warm at the horizon and quiet above it. The lowest tone is
  // not the fog's white: that left a wide empty gap over the horizon line.
  float t = smoothstep(0.0, 0.62, d.y);
  vec3 horizonTone = mix(uFogColor, uLightColor, 0.38);
  vec3 sky = mix(horizonTone, uZenith, t);

  // One large thing hanging in it. Far too big to be a sun, which is the
  // point — nothing produces awe as cheaply as size.
  float s = dot(d, uLightDir);
  float halo = smoothstep(uSunSize - 0.22, uSunSize, s);
  sky = mix(sky, mix(sky, uLightColor, 0.42), halo);
  float disc = smoothstep(uSunSize - 0.004, uSunSize + 0.001, s);
  sky = mix(sky, uLightColor, disc);

  col = mix(col, sky, presSky);

  // The one enormous thing. Not gated by the bloom: it stands on the far
  // world, and something to walk towards is the whole point of it.
  float rise;
  float mono = dwMonument(d, cameraPosition, rise);
  if (mono > 0.001) {
    vec3 monoCol = mix(uGroundLow, uZenith, 0.30) * 0.62;

    // It breathes the same air as the ridges, and the air is thickest at
    // the bottom: the foot dissolves into the haze and the top stands
    // clear of it. Without this it was a dark rectangle floating over a
    // white gap, the one thing in the scene the distance did not touch.
    float range = length(uMonumentPos - cameraPosition.xz);
    // Half the ground's haze at most: by the ground's own rule anything
    // at this range would be gone, and a landmark that the air erases is
    // not a landmark. Enough to place it in depth, not enough to lose it.
    float density = 3.05 / uViewDistance * uFogDensity;
    float haze = 0.55 * (1.0 - exp(-range * density * 0.55));
    haze *= 1.0 - 0.72 * smoothstep(0.05, 0.70, rise);
    monoCol = mix(monoCol, uFogColor, clamp(haze, 0.0, 1.0));

    col = mix(col, monoCol, mono);
  }

  // Clouds as silhouettes: flat shapes with an edge, not photographed
  // vapour. Same field the ground reads for its shade.
  if (presClouds > 0.002 && d.y > 0.010) {
    float reach = uCloudHeight / d.y;
    vec2 hit = cameraPosition.xz + d.xz * reach;
    float density = dwCloudField(hit);

    // Far down the plane one pixel spans whole clouds, which would shimmer.
    float far = smoothstep(1500.0, 9000.0, reach);
    density = mix(density, uCloudCover, far);

    // Shapes, but soft ones and close to the sky they sit in. Hard-edged
    // cloud up here pulls the eye off the ground.
    float shape = smoothstep(0.34, 0.66, density);
    vec3 cloudCol = mix(uFogColor, uZenith, 0.30);
    float horizon = smoothstep(0.010, 0.12, d.y);
    col = mix(col, cloudCol, shape * presClouds * horizon * 0.7);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(uniformGroups) {
    this.uniforms = Object.assign({}, ...uniformGroups);
    this.mesh = null;
    this.material = null;
    this.geometry = null;
  }

  // Built the first time anything overhead exists, and not before.
  _construct(scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader:
        WORLD_GLSL + BLOOM_GLSL + CLOUD_GLSL + MONUMENT_GLSL + FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      // Depth tested and drawn last, so the sky shader never runs on a
      // pixel the ground is going to cover. On a screen where the ground
      // fills the lower half that is half the sky's cost, for nothing.
      depthTest: true,
    });
    this.geometry = new THREE.SphereGeometry(4000, 48, 24);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    scene.add(this.mesh);
  }

  // `wanted` is not the presence at the player: the shader decides that per
  // direction. It only says whether there is any woken world at all yet, so
  // that an untouched world still costs a single pass.
  update(scene, camera, wanted) {
    if (wanted <= 0.002) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    if (!this.mesh) this._construct(scene);
    this.mesh.visible = true;
    this.mesh.position.copy(camera.position);
  }

  dispose() {
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
  }
}
