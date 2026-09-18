// traces.js — the walked line, and what it wakes.
//
// A trace is a point with an age and a strength. Nothing else is stored:
// no geometry, no heightmap, no terrain. Two fields are derived from the
// same points, both pure functions of the point set and the clock:
//
//   depth  — a narrow depression in the shared ground, for the path itself
//   bloom  — how awake this place is, tens of metres either side
//   wake   — the same thing over hundreds of metres, for the landscape
//
// Bloom is the mechanism behind growth. The world does not exist and then
// get turned up; it comes alive where people have walked and stays alive,
// and everywhere else there is still nothing. Traces and presence are the
// same mechanism, which is why they are computed here from the same points.
//
// Both fields are rasterised into small scrolling textures for display and
// evaluated analytically on the CPU where an exact answer is needed. The
// textures are caches, never the source of truth.
//
// Both belong to the ground layer: shared, and never touched by one
// player's own deviation vector.

import * as THREE from 'three';

const STORAGE_KEY = 'dreamworld.traces.v1';
const MAX_POINTS = 6000;              // ~3 km of walking before thinning

export const DEFAULT_TRACE_PARAMS = {
  // The depression is deliberately slight now. growth-and-look.md asks
  // for a path that comes alive rather than one that dents, and a narrow
  // deep groove also steps visibly against the disc's rings. The bloom
  // beside it is what the walked line is really for.
  radius: 1.4,        // metres of influence for the depression
  strength: 0.05,     // metres deep when fresh
  settle: 150.0,      // seconds to settle towards the permanent imprint
  permanence: 0.55,   // fraction of the depth that never recovers
  spacing: 0.55,      // metres between deposited points
  bloomRadius: 26.0,  // metres the world wakes either side of the line
  // Seconds before a step counts as fully awake. It has to be short
  // against radius over walking speed, or the waking ground never catches
  // up with the walker and they spend the whole time in a half-lit place.
  bloomRise: 2.0,
  // Relief answers to a far wider field than colour does. Sharing the
  // bloom's radius built an embankment that followed the trail with the
  // path's own groove along its crest — a landscape has to wake around the
  // walker, not under their feet.
  wakeRadius: 260.0,  // metres of landscape woken by being walked near
  wakeRise: 20.0,     // seconds; a hill rises slower than a footprint
};

// ------------------------------------------------------------------ store

export class TraceStore {
  constructor(params) {
    this.params = params || { ...DEFAULT_TRACE_PARAMS };
    this.points = [];        // { x, z, t0, s }
    this.fine = new Map();   // spatial hash at trace width
    this.coarse = new Map(); // spatial hash at bloom width
    this.broad = new Map();  // spatial hash at landscape width
    this.revision = 1;       // bumped on any change; fields watch it
    this.lastDeposit = null;
    this._saveAt = 0;
    this.load();
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  _put(map, cell, p) {
    const k = this._key(Math.floor(p.x / cell), Math.floor(p.z / cell));
    let bucket = map.get(k);
    if (!bucket) { bucket = []; map.set(k, bucket); }
    bucket.push(p);
  }

  reindex() {
    this.fine.clear();
    this.coarse.clear();
    this.broad.clear();
    for (const p of this.points) this._index(p);
    this.revision++;
  }

  _index(p) {
    this._put(this.fine, this.params.radius * 2, p);
    this._put(this.coarse, this.params.bloomRadius * 2, p);
    this._put(this.broad, this.params.wakeRadius * 2, p);
  }

  add(x, z, t0, s) {
    const p = { x, z, t0, s };
    this.points.push(p);
    if (this.points.length > MAX_POINTS) {
      this.points.splice(0, Math.floor(MAX_POINTS * 0.1));
      this.reindex();
    } else {
      this._index(p);
    }
    this.revision++;
    return p;
  }

  // Walking deposits a point every `spacing` metres. Standing still adds
  // nothing, so a player cannot dig a hole, or wake a place, by waiting.
  deposit(x, z, now) {
    const sp = this.params.spacing;
    const last = this.lastDeposit;
    if (last) {
      const dx = x - last.x, dz = z - last.z;
      if (dx * dx + dz * dz < sp * sp) return false;
    }
    this.lastDeposit = this.add(x, z, now, 1.0);
    return true;
  }

  // Largest of the overlapping points rather than their sum, for both
  // fields. Points sit closer together than they are wide, and summing
  // them would turn a footpath into a trench and a walk into a floodlight.
  _peak(map, cell, radius, x, z, weight) {
    const r2 = radius * radius;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let peak = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const bucket = map.get(this._key(cx + i, cz + j));
        if (!bucket) continue;
        for (const p of bucket) {
          const dx = x - p.x, dz = z - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r2) continue;
          const f = 1.0 - d2 / r2;
          const v = weight(p) * f * f;
          if (v > peak) peak = v;
        }
      }
    }
    return peak;
  }

  // Depth of the depression in metres. GPU twin: the splat pass below.
  depthAt(x, z, now) {
    const { radius, strength, settle, permanence } = this.params;
    return this._peak(this.fine, radius * 2, radius, x, z, (p) => {
      const age = Math.max(0, (now - p.t0) * 0.001);
      const decay = permanence + (1 - permanence) * Math.exp(-age / settle);
      return p.s * strength * decay;
    });
  }

  // How awake this place is, 0 to 1. A step does not wake the ground the
  // instant it lands, and what has woken never goes back to sleep.
  bloomAt(x, z, now) {
    const { bloomRadius, bloomRise } = this.params;
    return this._peak(this.coarse, bloomRadius * 2, bloomRadius, x, z, (p) => {
      const age = Math.max(0, (now - p.t0) * 0.001);
      return p.s * Math.min(1, age / Math.max(0.001, bloomRise));
    });
  }

  // How far the landscape has woken here, 0 to 1. Wide and slow, and never
  // the same radius as the path that caused it.
  wakeAt(x, z, now) {
    const { wakeRadius, wakeRise } = this.params;
    return this._peak(this.broad, wakeRadius * 2, wakeRadius, x, z, (p) => {
      const age = Math.max(0, (now - p.t0) * 0.001);
      return p.s * Math.min(1, age / Math.max(0.001, wakeRise));
    });
  }

  clear() {
    this.points.length = 0;
    this.fine.clear();
    this.coarse.clear();
    this.broad.clear();
    this.lastDeposit = null;
    this.revision++;
    this.save(true);
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1 || !Array.isArray(data.p)) return;
      for (const rec of data.p) this.add(rec[0], rec[1], rec[2], rec[3]);
      this.lastDeposit = null;
    } catch (err) {
      console.warn('traces: could not load, starting empty', err);
    }
  }

  save(force) {
    const now = Date.now();
    if (!force && now - this._saveAt < 3000) return;
    this._saveAt = now;
    try {
      const p = this.points.map((q) => [
        Math.round(q.x * 100) / 100,
        Math.round(q.z * 100) / 100,
        q.t0,
        Math.round(q.s * 100) / 100,
      ]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, p }));
    } catch (err) {
      console.warn('traces: could not save', err);
    }
  }
}

// ------------------------------------------------------------------ field

const SPLAT_VERT = /* glsl */`
attribute float aValue;
varying float vValue;
uniform float uTexels;
uniform float uFieldSize;
uniform float uRadius;
void main() {
  vValue = aValue;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = 2.0 * uRadius / uFieldSize * uTexels;
}
`;

const SPLAT_FRAG = /* glsl */`
varying float vValue;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  if (d2 >= 1.0) discard;
  float f = 1.0 - d2;
  gl_FragColor = vec4(vValue * f * f, 0.0, 0.0, 1.0);
}
`;

// The two fields differ only in how wide they are, how far they reach and
// what each point is worth. Everything else is the same machine.
const DEPTH_CONFIG = {
  prefix: 'uTrace',
  size: 200,     // metres covered
  texels: 1024,  // 0.2 m each: the path is only a metre wide
  radius: (params) => params.radius,
  weight: (params) => (p, age) => {
    const decay = params.permanence
      + (1 - params.permanence) * Math.exp(-age / params.settle);
    return p.s * params.strength * decay;
  },
};

const BLOOM_CONFIG = {
  prefix: 'uBloom',
  size: 512,     // metres covered: bloom has to outreach the fog
  texels: 512,   // 1 m each: it is a wide soft thing, it needs no detail
  radius: (params) => params.bloomRadius,
  weight: (params) => (p, age) =>
    p.s * Math.min(1, age / Math.max(0.001, params.bloomRise)),
};

const WAKE_CONFIG = {
  prefix: 'uWake',
  size: 2400,    // metres: the landscape reaches far past the fog
  texels: 256,   // 9 m each, and it is smoother than that anyway
  radius: (params) => params.wakeRadius,
  weight: (params) => (p, age) =>
    p.s * Math.min(1, age / Math.max(0.001, params.wakeRise)),
};

class PointField {
  constructor(renderer, store, config) {
    this.renderer = renderer;
    this.store = store;
    this.config = config;
    this.center = new THREE.Vector2(0, 0);
    this.lastDraw = -1e9;
    this.drawnRevision = -1;

    this.target = new THREE.WebGLRenderTarget(config.texels, config.texels, {
      format: THREE.RGBAFormat,
      // Half float: a groove is a few centimetres deep and the bloom is a
      // long smooth ramp; eight bits would terrace both.
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.target.texture.wrapT = THREE.ClampToEdgeWrapping;

    const half = config.size / 2;
    this.camera = new THREE.OrthographicCamera(-half, half, half, -half, -1, 1);

    // Allocated once, at the largest the point set is allowed to get, and
    // rewritten in place. Handing the renderer a fresh buffer on every
    // redraw would leak one GPU allocation per redraw, for ever.
    this.posArray = new Float32Array(MAX_POINTS * 3);
    this.valArray = new Float32Array(MAX_POINTS);
    this.posAttr = new THREE.BufferAttribute(this.posArray, 3);
    this.valAttr = new THREE.BufferAttribute(this.valArray, 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.valAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aValue', this.valAttr);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexels: { value: config.texels },
        uFieldSize: { value: config.size },
        uRadius: { value: config.radius(store.params) },
      },
      vertexShader: SPLAT_VERT,
      fragmentShader: SPLAT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });

    this.mesh = new THREE.Points(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    this.uniforms = {
      [config.prefix + 'Map']: { value: this.target.texture },
      [config.prefix + 'Center']: { value: this.center },
      [config.prefix + 'FieldSize']: { value: config.size },
    };
  }

  update(playerX, playerZ, now) {
    const moved = Math.hypot(playerX - this.center.x, playerZ - this.center.y);
    const stale = now - this.lastDraw;
    if (moved > this.config.size * 0.2) {
      this.center.set(playerX, playerZ);
      this.draw(now);
    } else if (this.drawnRevision !== this.store.revision && stale > 100) {
      this.draw(now);
    } else if (stale > 2000) {
      this.draw(now);   // ages move on, so the cache has to be refreshed
    }
  }

  draw(now) {
    this.lastDraw = now;
    this.drawnRevision = this.store.revision;

    const params = this.store.params;
    const radius = this.config.radius(params);
    const weight = this.config.weight(params);
    this.material.uniforms.uRadius.value = radius;

    const half = this.config.size / 2 + radius;
    const pos = this.posArray;
    const val = this.valArray;
    let count = 0;
    for (const p of this.store.points) {
      const dx = p.x - this.center.x;
      const dz = p.z - this.center.y;
      if (Math.abs(dx) > half || Math.abs(dz) > half) continue;
      const age = Math.max(0, (now - p.t0) * 0.001);
      pos[count * 3] = dx;
      pos[count * 3 + 1] = dz;
      pos[count * 3 + 2] = 0;
      val[count] = weight(p, age);
      count++;
      if (count >= MAX_POINTS) break;
    }

    this.posAttr.needsUpdate = true;
    this.valAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, count);

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    if (count > 0) r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
  }

  dispose() {
    this.target.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class TraceField {
  constructor(renderer, store) {
    this.store = store;
    this.depth = new PointField(renderer, store, DEPTH_CONFIG);
    this.bloom = new PointField(renderer, store, BLOOM_CONFIG);
    this.wake = new PointField(renderer, store, WAKE_CONFIG);
    this.uniforms = Object.assign(
      { uTraceRef: { value: store.params.strength } },
      this.depth.uniforms,
      this.bloom.uniforms,
      this.wake.uniforms,
    );
  }

  update(playerX, playerZ, now) {
    this.uniforms.uTraceRef.value = this.store.params.strength;
    this.depth.update(playerX, playerZ, now);
    this.bloom.update(playerX, playerZ, now);
    this.wake.update(playerX, playerZ, now);
  }

  draw(now) {
    this.depth.draw(now);
    this.bloom.draw(now);
    this.wake.draw(now);
  }

  dispose() {
    this.depth.dispose();
    this.bloom.dispose();
    this.wake.dispose();
  }
}

// ------------------------------------------------------------ GLSL twins

export const TRACE_GLSL = /* glsl */`
uniform sampler2D uTraceMap;
uniform vec2 uTraceCenter;
uniform float uTraceFieldSize;
uniform float uTraceRef;   // depth of a fresh trace, for reading strength

// Metres of depression at a world position.
float dwTraceDepth(vec2 p) {
  vec2 uv = (p - uTraceCenter) / uTraceFieldSize + 0.5;
  vec2 edge = smoothstep(0.0, 0.03, uv) * smoothstep(0.0, 0.03, 1.0 - uv);
  float w = edge.x * edge.y;
  if (w <= 0.0) return 0.0;
  return texture2D(uTraceMap, uv).r * w;
}
`;

export const WAKE_GLSL = /* glsl */`
uniform sampler2D uWakeMap;
uniform vec2 uWakeCenter;
uniform float uWakeFieldSize;

// How far the landscape has woken here, 0 to 1.
float dwWake(vec2 p) {
  vec2 uv = (p - uWakeCenter) / uWakeFieldSize + 0.5;
  vec2 edge = smoothstep(0.0, 0.02, uv) * smoothstep(0.0, 0.02, 1.0 - uv);
  float w = edge.x * edge.y;
  if (w <= 0.0) return 0.0;
  return clamp(texture2D(uWakeMap, uv).r, 0.0, 1.0) * w;
}
`;

export const BLOOM_GLSL = /* glsl */`
uniform sampler2D uBloomMap;
uniform vec2 uBloomCenter;
uniform float uBloomFieldSize;

// How awake a place is, 0 to 1. Zero is the Nothing.
float dwBloom(vec2 p) {
  vec2 uv = (p - uBloomCenter) / uBloomFieldSize + 0.5;
  vec2 edge = smoothstep(0.0, 0.02, uv) * smoothstep(0.0, 0.02, 1.0 - uv);
  float w = edge.x * edge.y;
  if (w <= 0.0) return 0.0;
  return clamp(texture2D(uBloomMap, uv).r, 0.0, 1.0) * w;
}
`;
