// ui.js — the tuning surface.
//
// Every number that shapes the look of the world is reachable here while it
// runs. This is not game UI; it is the instrument panel the world is tuned
// with, and it is deliberately built before anything else needs it.
//
// UI strings are Czech by decision (see NEXT.md). Code, comments and
// documentation stay English.

import { deviationFrom, paletteName } from './deviation.js';
import { ELEMENTS_BUILT, presenceFrom, emptyOverrides } from './presence.js';

const SETTINGS_KEY = 'dreamworld.settings.v1';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function loadSettings(defaults) {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw);
    return {
      identity: saved.identity ?? defaults.identity,
      epoch: saved.epoch ?? defaults.epoch,
      dev: { ...defaults.dev, ...(saved.dev || {}) },
      base: { ...defaults.base, ...(saved.base || {}) },
      trace: { ...defaults.trace, ...(saved.trace || {}) },
      region: { ...defaults.region, ...(saved.region || {}) },
      presence: { ...defaults.presence, ...(saved.presence || {}) },
      quality: { ...defaults.quality, ...(saved.quality || {}) },
    };
  } catch (err) {
    console.warn('settings: could not load', err);
    return defaults;
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('settings: could not save', err);
  }
}

const TAU = Math.PI * 2;

// [key, label, min, max, step]
const PRESENCE_LABELS = {
  sky: 'obloha',
  clouds: 'mraky',
  cloudShadows: 'stíny mraků',
  relief: 'reliéf',
  groundCover: 'porost',
  monument: 'ta velká věc',
  brokenLaw: 'porušený zákon',
};

const AIR_FIELDS = [
  ['paletteIndex', 'paleta', 0, 11, 1],
  ['paletteShift', 'posun barev', -0.06, 0.06, 0.002],
  ['paletteLift', 'světlost palety', -0.09, 0.09, 0.002],
  ['lightAngle', 'směr světla', 0, TAU, 0.01],
  ['lightHeight', 'výška světla', 0.03, 0.95, 0.01],
  ['lightWarmth', 'teplota světla', -0.2, 0.2, 0.005],
  ['viewDistance', 'dohlednost (m)', 40, 400, 1],
  ['fogDensity', 'hustota mlhy', 0.3, 2.5, 0.01],
  ['windDir', 'směr větru', 0, TAU, 0.01],
  ['windSpeed', 'síla větru', 0, 4, 0.01],
  ['grainScale', 'měřítko zrna', 0.2, 4, 0.01],
  ['grainStrength', 'síla zrna', 0, 1.5, 0.01],
  ['sunAngle', 'velikost slunce', 0.02, 0.6, 0.005],
  ['skyProbe', 'dosah oblohy (m)', 5, 200, 1],
];

const CLOUD_FIELDS = [
  ['cloudCover', 'pokrytí', 0, 1, 0.01],
  ['cloudHeight', 'výška (m)', 80, 1500, 10],
  ['cloudScale', 'měřítko', 0.001, 0.012, 0.0002],
  ['cloudDrift', 'unášení', 0, 15, 0.05],
  ['shadowStrength', 'síla stínu', 0, 1, 0.01],
];

const GROUND_FIELDS = [
  ['swellAmp', 'vlna — výška (m)', 0, 8, 0.05],
  ['swellScale', 'vlna — délka (m)', 100, 900, 5],
  ['rollAmp', 'zvlnění — výška (m)', 0, 1.5, 0.01],
  ['rollScale', 'zvlnění — délka (m)', 6, 60, 0.5],
  ['reliefAmp', 'reliéf — výška (m)', 0, 40, 0.5],
  ['reliefScale', 'reliéf — délka (m)', 30, 400, 5],
  ['breathAmp', 'dýchání (m)', 0, 0.4, 0.005],
];

const REGION_FIELDS = [
  ['cell', 'velikost kraje (m)', 120, 2000, 10],
  ['amplitude', 'zdvih obzoru (m)', 0, 90, 1],
];

const TRACE_FIELDS = [
  ['radius', 'šířka stopy (m)', 0.4, 4, 0.05],
  ['strength', 'hloubka stopy (m)', 0, 0.5, 0.005],
  ['permanence', 'trvalost', 0, 1, 0.01],
  ['settle', 'usazování (s)', 10, 600, 5],
  ['spacing', 'rozestup bodů (m)', 0.2, 2, 0.05],
  ['bloomRadius', 'šířka rozkvětu (m)', 2, 60, 0.5],
  ['bloomRise', 'doba probuzení (s)', 0, 60, 0.5],
  ['wakeRadius', 'šířka krajiny (m)', 40, 800, 10],
  ['wakeRise', 'probuzení krajiny (s)', 1, 120, 1],
];

function formatValue(v, step) {
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2
    : step >= 0.001 ? 3 : 4;
  return v.toFixed(dec);
}

export function createUI(opts) {
  const {
    settings, onChange, onTraceParams, onClearTraces, onReset, onQuality,
    localBloom = () => 1,
  } = opts;

  const root = el('div', 'panel');
  const head = el('div', 'panel-head');
  head.appendChild(el('span', 'panel-title', 'Dream World'));
  head.appendChild(el('span', 'panel-hint', 'H skryje panel'));
  root.appendChild(head);

  const body = el('div', 'panel-body');
  root.appendChild(body);

  const refreshers = [];

  function addGroup(title, note) {
    const g = el('div', 'group');
    g.appendChild(el('div', 'group-title', title));
    if (note) g.appendChild(el('div', 'group-note', note));
    body.appendChild(g);
    return g;
  }

  // One row, driven by a getter and a setter rather than by an object and a
  // key, so a slider can stand for a computed value as easily as a stored one.
  function addSlider(parent, label, min, max, step, get, set, after) {
    const row = el('label', 'row');
    row.appendChild(el('span', 'row-label', label));
    const input = el('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = get();
    const val = el('span', 'row-value', formatValue(get(), step));
    input.addEventListener('input', () => {
      set(parseFloat(input.value));
      val.textContent = formatValue(get(), step);
      if (after) after();
      onChange();
    });
    row.appendChild(input);
    row.appendChild(val);
    parent.appendChild(row);
    refreshers.push(() => {
      input.value = get();
      val.textContent = formatValue(get(), step);
    });
  }

  function addFields(parent, fields, target, after) {
    for (const [key, label, min, max, step] of fields) {
      addSlider(parent, label, min, max, step,
        () => target[key], (v) => { target[key] = v; }, after);
    }
  }

  // ---------------------------------------------------------------- growth
  const ggrow = addGroup('Růst',
    'růst je strop, který dá život člověka; svět se probouzí tam, '
    + 'kudy jsi šel, a jinde zůstává nic');

  addSlider(ggrow, 'růst', 0, 1, 0.005,
    () => settings.dev.growth,
    (v) => {
      settings.dev.growth = v;
      // Moving growth puts every element back under its control.
      settings.presence = emptyOverrides();
    },
    () => refresh());

  // These read the presence where the player is standing. Dragging one
  // pins that element everywhere instead, which is how it gets tuned.
  for (const key of ELEMENTS_BUILT) {
    addSlider(ggrow, PRESENCE_LABELS[key], 0, 1, 0.01,
      () => presenceFrom(settings.dev.growth * localBloom(), settings.presence)[key],
      (v) => { settings.presence[key] = v; });
  }

  // -------------------------------------------------------------- identity
  const gid = addGroup('Odchylka', 'osobní vrstva — mění jen vzduch, nikdy zem');
  const paletteLabel = el('div', 'group-note', '');
  const idRow = el('div', 'row');
  const idInput = el('input', 'text');
  idInput.type = 'text';
  idInput.value = settings.identity;
  idInput.spellcheck = false;

  // The deviation object is written into, never replaced: the sliders hold
  // a reference to it and would otherwise end up editing a discarded copy.
  // Growth survives a reroll — it is a life, not a dice throw.
  function reroll() {
    const growth = settings.dev.growth;
    Object.assign(settings.dev,
      deviationFrom(settings.identity, settings.epoch, growth));
    refresh();
    onChange();
  }

  idInput.addEventListener('change', () => {
    settings.identity = idInput.value;
    reroll();
  });
  const rerollBtn = el('button', 'btn', 'jiný den');
  rerollBtn.title = 'Tatáž identita v jiném čase dá jiný svět';
  rerollBtn.addEventListener('click', () => {
    settings.epoch = (settings.epoch + 1) | 0;
    reroll();
  });
  idRow.appendChild(el('span', 'row-label', 'identita'));
  idRow.appendChild(idInput);
  idRow.appendChild(rerollBtn);
  gid.appendChild(idRow);

  const showPaletteName = () => {
    paletteLabel.textContent = 'paleta: ' + paletteName(settings.dev);
  };
  addFields(gid, AIR_FIELDS, settings.dev, showPaletteName);
  gid.appendChild(paletteLabel);
  refreshers.push(showPaletteName);

  // ---------------------------------------------------------------- clouds
  const gcloud = addGroup('Mraky', 'jedno pole — nahoře i jako stín na zemi');
  addFields(gcloud, CLOUD_FIELDS, settings.dev);

  // ---------------------------------------------------------------- region
  const gregion = addGroup('Kraje',
    'v každém kraji přestane platit jeden zákon — zatím obzor, který se '
    + 'zvedá do mísy; sdílená zem, jde přes směs party');
  addFields(gregion, REGION_FIELDS, settings.region);

  // ---------------------------------------------------------------- ground
  const gground = addGroup('Základní svět', 'sdílená zem — stejná pro všechny');
  addFields(gground, GROUND_FIELDS, settings.base);

  // ---------------------------------------------------------------- traces
  const gtrace = addGroup('Stopy', 'jediné orientační body, jaké tu kdy budou');
  addFields(gtrace, TRACE_FIELDS, settings.trace, onTraceParams);

  const traceButtons = el('div', 'row buttons');
  const clearBtn = el('button', 'btn', 'smazat stopy');
  clearBtn.addEventListener('click', () => onClearTraces());
  const resetBtn = el('button', 'btn', 'zpět na výchozí');
  resetBtn.addEventListener('click', () => { onReset(); refresh(); });
  traceButtons.appendChild(clearBtn);
  traceButtons.appendChild(resetBtn);
  gtrace.appendChild(traceButtons);

  // ---------------------------------------------------------------- cost
  const gcost = addGroup('Obraz', 'kolik pixelů karta dostane — nic o světě');
  addSlider(gcost, 'rozlišení', 0.4, 1.6, 0.05,
    () => settings.quality.scale,
    (v) => { settings.quality.scale = v; }, onQuality);
  addSlider(gcost, 'vyhlazení hran', 0, 1, 1,
    () => settings.quality.msaa,
    (v) => { settings.quality.msaa = v; });
  gcost.appendChild(el('div', 'group-note',
    'vyhlazení se projeví až po znovunačtení stránky'));

  document.body.appendChild(root);

  function refresh() {
    idInput.value = settings.identity;
    for (const fn of refreshers) fn();
  }

  let visible = true;
  function toggle(force) {
    visible = force === undefined ? !visible : force;
    root.classList.toggle('hidden', !visible);
  }

  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyH') toggle();
  });

  return { root, refresh, toggle };
}

// ------------------------------------------------------------------- HUD

export function createHUD() {
  const root = el('div', 'hud');
  const cost = el('div', 'hud-cost');
  const info = el('div', 'hud-info');
  root.appendChild(cost);
  root.appendChild(info);
  document.body.appendChild(root);

  let acc = 0, frames = 0, work = 0, gpu = 0, fps = 0, haveGpu = false;

  // Whose world this is, when someone arrived from Kamosféra.
  const who = el('div', 'hud-who');
  root.insertBefore(who, cost);

  return {
    who(name, growth) {
      who.textContent = `${name} · ${Math.round((growth || 0) * 100)} %`;
    },
    // The number that matters is what the card took. The time spent in
    // JavaScript is shown next to it, small, because on this world it is
    // nearly always the lesser half and used to be mistaken for the whole.
    frame(dt, workMs, gpuMs, gpuSupported) {
      acc += dt; frames++;
      work += (workMs - work) * 0.1;
      gpu = gpuMs;
      haveGpu = gpuSupported;
      if (acc >= 0.5) { fps = frames / acc; acc = 0; frames = 0; }
    },
    set(tris, calls, traces, x, z, here) {
      cost.textContent = haveGpu
        ? `${gpu.toFixed(1)} ms karta · ${work.toFixed(1)} ms kód · ${fps.toFixed(0)} fps`
        : `${work.toFixed(1)} ms kód · ${fps.toFixed(0)} fps`;
      info.textContent =
        `${(tris / 1000).toFixed(0)}k trojúhelníků · ${calls} vykreslení · ` +
        `${traces} stop · ${x.toFixed(0)}, ${z.toFixed(0)} · ` +
        `svět zde ${here.toFixed(2)}`;
    },
  };
}

// ------------------------------------------------------------------ hint

export function createHint() {
  const root = el('div', 'hint');
  root.innerHTML =
    '<strong>klikni pro vstup</strong>' +
    '<span>WASD chůze · Shift běh · myš rozhled · Esc ven · H panel</span>';
  document.body.appendChild(root);
  return {
    show(v) { root.classList.toggle('hidden', !v); },
  };
}
