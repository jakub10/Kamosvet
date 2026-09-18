// clock.js — one time source for everything that moves.
//
// Wall-clock based, measured from a fixed world epoch, so two machines
// reading it agree without talking to each other. `offsetMs` is where a
// server correction goes when there is a server.
//
// Shaders never see this time. A 32-bit float loses whole seconds once the
// number grows large, so time reaches the GPU only as a phase or an offset
// that has already been wrapped into the period of the noise it drives.
// Wrapping happens here, in double precision, which is why the pattern can
// drift for ever without drifting apart or jumping.

const WORLD_EPOCH_MS = Date.UTC(2026, 0, 1);

export class WorldClock {
  constructor() {
    this.offsetMs = 0;
  }

  // Milliseconds on the shared timeline. Trace ages are measured with this.
  nowMs() {
    return Date.now() + this.offsetMs;
  }

  // Seconds since the world epoch. A double, and it stays on the CPU.
  seconds() {
    return (this.nowMs() - WORLD_EPOCH_MS) / 1000;
  }
}

export function wrap(value, period) {
  return value - Math.floor(value / period) * period;
}

// Phase for a term that samples noise along one axis as time passes.
export function scrollPhase(seconds, rate, period) {
  return wrap(seconds * rate, period);
}

// Offset for a field that drifts with the wind, in the noise's own units.
// `scale` converts metres to noise units; `period` is the lattice period of
// the periodic noise it will be fed to.
export function driftOffset(seconds, dirRad, speed, scale, period) {
  const travelled = seconds * speed * scale;
  return [
    wrap(Math.cos(dirRad) * travelled, period),
    wrap(Math.sin(dirRad) * travelled, period),
  ];
}
