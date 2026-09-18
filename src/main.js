// main.js — puts the world on screen and keeps it running.
//
// Order of things: the shared ground first, then the traces that mark it,
// then the personal air laid over both. Nothing here holds world state; it
// only wires the pure functions to a renderer, a body and a clock.

import * as THREE from 'three';
import {
  DEFAULT_BASE, BREATH_PERIOD, GUST_PERIOD, baseHeight,
  makeWorldUniforms, applyBaseToUniforms,
} from './world.js';
import {
  DEFAULT_IDENTITY, DEFAULT_GROWTH, deviationFrom, paletteFrom,
  lightDirection, partyFrom,
} from './deviation.js';
import { WorldClock, scrollPhase, driftOffset } from './clock.js';
import { presenceFrom, emptyOverrides, windowOf } from './presence.js';
import {
  makeMonumentUniforms, updateMonumentUniforms, MONUMENT_GLSL,
} from './monument.js';
import {
  makeCloudUniforms, updateCloudUniforms, mistOffset,
} from './clouds.js';
import { TraceStore, TraceField, DEFAULT_TRACE_PARAMS } from './traces.js';
import { Terrain } from './terrain.js';
import { Sky } from './sky.js';
import { Cover } from './cover.js';
import {
  DEFAULT_REGION, regionHeight, makeRegionUniforms, applyRegionToUniforms,
} from './region.js';
import { Player } from './player.js';
import { createUI, createHUD, createHint, loadSettings, saveSettings } from './ui.js';
import { GpuTimer } from './gputimer.js';
import { loadSeed } from './kamosfera.js';

function fail(message) {
  const box = document.createElement('div');
  box.className = 'failure';
  box.textContent = message;
  document.body.appendChild(box);
}

window.addEventListener('error', (e) => fail('Chyba: ' + e.message));

function boot(seed) {
  const canvas = document.getElementById('view');

  // Read before anything else: the renderer cannot change its mind about
  // multisampling later.
  let wantMsaa = false;
  try {
    const saved = JSON.parse(localStorage.getItem('dreamworld.settings.v1'));
    wantMsaa = !!(saved && saved.quality && saved.quality.msaa);
  } catch (err) { wantMsaa = false; }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: wantMsaa });
  } catch (err) {
    fail('Tento prohlížeč neumí WebGL 2. Zkus Chrome nebo Edge.');
    return;
  }
  renderer.info.autoReset = false;
  const gpuTimer = new GpuTimer(renderer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 6000);
  const clock = new WorldClock();

  // ------------------------------------------------------------ settings
  const defaults = {
    identity: DEFAULT_IDENTITY,
    epoch: 0,
    dev: deviationFrom(DEFAULT_IDENTITY, 0, DEFAULT_GROWTH),
    base: { ...DEFAULT_BASE },
    trace: { ...DEFAULT_TRACE_PARAMS },
    presence: emptyOverrides(),
    region: { ...DEFAULT_REGION },
    // Not traits of the world: how many pixels the card is asked for, and
    // whether it also has to multisample them. Hardware antialiasing costs
    // 16 ms of an empty frame at this size on integrated graphics, and this
    // world draws its own edges in the shader anyway.
    quality: { scale: 1.0, msaa: 0 },
  };
  const settings = loadSettings(defaults);
  // A person who arrived from Kamosféra brings their own numbers. They
  // outrank anything saved on this machine: the world is theirs, not the
  // browser's. The panel can still move them afterwards, for tuning.
  if (seed) {
    settings.identity = seed.identity;
    settings.epoch = seed.epoch;
    settings.dev = deviationFrom(seed.identity, seed.epoch, seed.growth);
    settings.seed = seed;
  }

  // -------------------------------------------------------------- pieces
  const worldU = makeWorldUniforms(settings.base);
  const cloudU = makeCloudUniforms();
  const monumentU = makeMonumentUniforms();
  const regionU = makeRegionUniforms();
  const personalU = {
    uFogColor: { value: new THREE.Vector3() },
    uZenith: { value: new THREE.Vector3() },
    uGroundHigh: { value: new THREE.Vector3() },
    uGroundLow: { value: new THREE.Vector3() },
    uTraceTint: { value: new THREE.Vector3() },
    uLightColor: { value: new THREE.Vector3() },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uFogDensity: { value: 1 },
    uViewDistance: { value: 120 },
    uGrainScale: { value: 1 },
    uGrainStrength: { value: 1 },
    uMistOffset: { value: [0, 0] },
    uGustOffset: { value: [0, 0] },
    uWindDir: { value: 0 },
    uWindSpeed: { value: 1 },
    uViewDir: { value: new THREE.Vector3(0, 0, -1) },
  };

  // Growth reaches the ground shader as a place, not as a number: the
  // ceiling is what this person's life allows to wake, and the bloom field
  // says where it has actually woken.
  const growthU = {
    uGrowthCeiling: { value: 0 },
    uPartyCeiling: { value: 0 },
    uWinRelief: { value: windowOf('relief') },
    uWinSky: { value: windowOf('sky') },
    uOvrSky: { value: -1 },
    uWinClouds: { value: windowOf('clouds') },
    uOvrClouds: { value: -1 },
    uWinCloudShadows: { value: windowOf('cloudShadows') },
    uOvrCloudShadows: { value: -1 },
    uPresenceCover: { value: 0 },
    // How far along a view direction the sky asks about the ground.
    uSkyProbe: { value: 45 },
    uSunSize: { value: Math.cos(0.2) },
  };

  const traces = new TraceStore(settings.trace);
  const field = new TraceField(renderer, traces);
  const terrain = new Terrain(
    [worldU, field.uniforms, personalU, cloudU, growthU, regionU]);
  const sky = new Sky(
    [worldU, personalU, cloudU, growthU, monumentU, field.uniforms]);
  const cover = new Cover(
    [worldU, personalU, growthU, regionU, field.uniforms]);
  scene.add(terrain.mesh);

  const player = new Player(canvas);
  const hud = createHUD();
  if (seed && seed.name) hud.who(seed.name, seed.growth);
  const hint = createHint();
  player.onLockChange = (locked) => hint.show(!locked);

  // Presence is no longer one number for the whole world. This is the
  // presence where the player is standing, which is what the sky and the
  // clouds overhead answer to; the ground works it out per pixel.
  let applyQuality = () => {};
  let presence = presenceFrom(0, settings.presence);
  let bloomHere = 0;
  let breathPhase = 0;

  // What the ground is allowed to know about the people on it: the mix of
  // everyone present, never one person's own vector. With one player the
  // mix is that player.
  let party = partyFrom([{ growth: 0 }]);
  const RELIEF_WINDOW = windowOf('relief');

  function smoothstep01(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // The ground, as the player feels it. Exactly the terms the vertex shader
  // uses: shared base shaped by the shared relief, minus the shared traces.
  function groundHeightAt(x, z) {
    const now = clock.nowMs();
    // The wide wake, exactly as the vertex shader reads it. Using the
    // narrow bloom here would put the collision surface on a different
    // hill from the drawn one.
    const relief = smoothstep01(RELIEF_WINDOW[0], RELIEF_WINDOW[1],
      party.growth * traces.wakeAt(x, z, now));
    return baseHeight(x, z, breathPhase, settings.base, relief)
      + regionHeight(x, z, regionU.uLawStrength.value, settings.region)
      - traces.depthAt(x, z, now);
  }

  function applySettings() {
    const d = settings.dev;
    const p = paletteFrom(d);
    const set = (u, c) => u.value.set(c[0], c[1], c[2]);
    set(personalU.uFogColor, p.fog);
    set(personalU.uZenith, p.zenith);
    set(personalU.uGroundHigh, p.groundHigh);
    set(personalU.uGroundLow, p.groundLow);
    set(personalU.uTraceTint, p.trace);
    set(personalU.uLightColor, p.light);
    const l = lightDirection(d);
    personalU.uLightDir.value.set(l[0], l[1], l[2]).normalize();
    personalU.uFogDensity.value = d.fogDensity;
    personalU.uViewDistance.value = d.viewDistance;
    personalU.uGrainScale.value = d.grainScale;
    personalU.uGrainStrength.value = d.grainStrength;
    personalU.uWindDir.value = d.windDir;
    personalU.uWindSpeed.value = d.windSpeed;

    growthU.uGrowthCeiling.value = d.growth;
    const forced = (key) => {
      const v = settings.presence[key];
      return (v === null || v === undefined) ? -1 : v;
    };
    growthU.uOvrSky.value = forced('sky');
    growthU.uOvrClouds.value = forced('clouds');
    growthU.uOvrCloudShadows.value = forced('cloudShadows');
    // Cover exists for the person; whether it exists *here* is the blade's
    // own business, and it asks the same fields the ground does.
    growthU.uPresenceCover.value =
      presenceFrom(d.growth, settings.presence).groundCover;
    growthU.uSunSize.value = Math.cos(d.sunAngle);
    growthU.uSkyProbe.value = d.skyProbe;
    party = partyFrom([{ growth: d.growth }]);
    growthU.uPartyCeiling.value = party.growth;
    // The law shapes the shared ground, so it answers to the party mix.
    applyRegionToUniforms(regionU, settings.region,
      presenceFrom(party.growth, settings.presence).brokenLaw);

    applyBaseToUniforms(worldU, settings.base);
    renderer.setClearColor(new THREE.Color(p.fog[0], p.fog[1], p.fog[2]), 1);
    saveSettings(settings);
  }

  createUI({
    settings,
    localBloom: () => bloomHere,
    onChange: applySettings,
    onTraceParams: () => traces.reindex(),
    onQuality: () => applyQuality(),
    onClearTraces: () => { traces.clear(); field.draw(clock.nowMs()); },
    onReset: () => {
      settings.identity = DEFAULT_IDENTITY;
      settings.epoch = 0;
      Object.assign(settings.dev,
        deviationFrom(DEFAULT_IDENTITY, 0, DEFAULT_GROWTH));
      Object.assign(settings.base, DEFAULT_BASE);
      Object.assign(settings.trace, DEFAULT_TRACE_PARAMS);
      settings.presence = emptyOverrides();
      traces.reindex();
      applySettings();
    },
  });
  applySettings();

  // The canvas keeps its own size from the stylesheet; only the drawing
  // buffer is set here. The window can also report nothing at all (a hidden
  // tab, a collapsed pane), and rendering into that leaves a canvas that
  // never comes back — so the size is watched rather than listened for once.
  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    // Capped at one. Beyond that the card draws four pixels for every one
    // anybody sees, and this world is flat colour — it gains nothing.
    const dpr = Math.min(window.devicePixelRatio, 1) * settings.quality.scale;
    if (canvas.width === Math.round(w * dpr)
      && canvas.height === Math.round(h * dpr)) return;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  resize();
  applyQuality = resize;

  // Debug handle. Not used by the world, but it means anything can be
  // inspected or driven from outside without adding buttons for it.
  window.dreamworld = {
    renderer, scene, camera, clock, player, traces, field, terrain, sky, cover,
    settings, applySettings,
    presence: () => presence, bloomHere: () => bloomHere,
  };

  const persist = () => traces.save(true);
  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });

  // ---------------------------------------------------------------- loop
  let last = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) * 0.001);
    last = now;
    const workStart = performance.now();

    // One clock. Everything animated reads it, and it reaches the GPU only
    // as phases that have already been wrapped.
    const seconds = clock.seconds();
    const wallNow = clock.nowMs();
    breathPhase = scrollPhase(seconds, settings.base.breathRate, BREATH_PERIOD);
    worldU.uBreathPhase.value = breathPhase;

    const mist = mistOffset(seconds, settings.dev);
    personalU.uMistOffset.value[0] = mist[0];
    personalU.uMistOffset.value[1] = mist[1];

    // The same wind, one scale finer, for anything with a stalk.
    const gust = driftOffset(seconds, settings.dev.windDir,
      settings.dev.windSpeed * 1.4, 0.006, GUST_PERIOD);
    personalU.uGustOffset.value[0] = gust[0];
    personalU.uGustOffset.value[1] = gust[1];

    player.update(dt, camera, groundHeightAt);

    if (player.speed > 0.3) {
      if (traces.deposit(player.position.x, player.position.z, wallNow)) {
        traces.save(false);
      }
    }

    // What is overhead belongs to the ground underfoot: the sky opens over
    // woken land and closes again over the Nothing.
    bloomHere = traces.bloomAt(player.position.x, player.position.z, wallNow);
    presence = presenceFrom(settings.dev.growth * bloomHere, settings.presence);
    updateCloudUniforms(cloudU, settings.dev, presence, seconds);

    // The monument answers to the party ceiling alone. It stands far past
    // anything anyone has walked, so gating it on the bloom would mean
    // never seeing it.
    const monumentPresence = presenceFrom(party.growth, settings.presence).monument;
    updateMonumentUniforms(monumentU, camera.position.x, camera.position.z,
      monumentPresence);

    field.update(player.position.x, player.position.z, wallNow);
    terrain.update(camera.position.x, camera.position.z,
      personalU.uViewDistance.value);
    sky.update(scene, camera,
      traces.points.length > 0 ? settings.dev.growth : 0);
    camera.getWorldDirection(personalU.uViewDir.value);
    cover.update(scene, camera, growthU.uPresenceCover.value);

    renderer.info.reset();
    gpuTimer.begin();
    renderer.render(scene, camera);
    gpuTimer.end();

    hud.frame(dt, performance.now() - workStart, gpuTimer.poll(),
      gpuTimer.supported);
    hud.set(renderer.info.render.triangles, renderer.info.render.calls,
      traces.points.length, player.position.x, player.position.z,
      settings.dev.growth * bloomHere);
  }

  requestAnimationFrame(frame);
}

// The seed comes first, then the world. Without Kamosféra the world boots
// as the Nothing, which is what it is supposed to be.
loadSeed().then(boot, () => boot(null));
