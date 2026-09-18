// gputimer.js — how long the card actually took.
//
// The frame cost on screen used to be the time this file's caller spent in
// JavaScript, which on a world like this one is nearly nothing: it said
// 1 ms while the card was taking fifty. An instrument that lies is worse
// than no instrument, because it sends you looking in the wrong place.
//
// This asks the driver instead. One query in flight at a time; the answer
// arrives a frame or two later, which is fine for a readout.

export class GpuTimer {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.query = null;
    this.pending = null;
    this.ms = 0;
    this.supported = !!this.ext;
  }

  begin() {
    if (!this.supported || this.pending) return;
    const gl = this.gl;
    this.query = gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query);
    this.open = true;
  }

  end() {
    if (!this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending = this.query;
    this.open = false;
  }

  // Called once a frame; returns the most recent completed measurement.
  poll() {
    if (!this.pending) return this.ms;
    const gl = this.gl;
    const done = gl.getQueryParameter(this.pending, gl.QUERY_RESULT_AVAILABLE);
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    if (done) {
      if (!disjoint) {
        const ns = gl.getQueryParameter(this.pending, gl.QUERY_RESULT);
        const sample = ns / 1e6;
        this.ms = this.ms === 0 ? sample : this.ms + (sample - this.ms) * 0.15;
      }
      gl.deleteQuery(this.pending);
      this.pending = null;
    }
    return this.ms;
  }
}
