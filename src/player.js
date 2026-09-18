// player.js — one body, walking.
//
// The player is a position, a heading and a velocity. Nothing about the
// player is stored in the renderer, and the ground height is asked for
// through a function so that the same controller can later run against a
// server's copy of the world.

import * as THREE from 'three';

const EYE_HEIGHT = 1.68;
const WALK_SPEED = 3.4;
const RUN_SPEED = 6.6;
const ACCEL = 12.0;
const LOOK_SPEED = 0.0022;
const PITCH_LIMIT = 1.45;

export class Player {
  constructor(canvas) {
    this.canvas = canvas;
    this.position = new THREE.Vector3(0, 0, 0);   // feet, on the ground
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.06;
    this.eye = EYE_HEIGHT;
    this.smoothGround = null;
    this.bobPhase = 0;
    this.locked = false;
    this.keys = new Set();
    this.speed = 0;

    this._onKeyDown = (e) => {
      if (this._typing(e)) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMove = (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * LOOK_SPEED;
      this.pitch -= e.movementY * LOOK_SPEED;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.keys.clear();
      if (this.onLockChange) this.onLockChange(this.locked);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    canvas.addEventListener('mousedown', () => {
      if (!this.locked) canvas.requestPointerLock();
    });
  }

  _typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  }

  update(dt, camera, groundHeightAt) {
    const k = this.keys;
    let fwd = 0, side = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fwd += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fwd -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) side += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) side -= 1;

    const len = Math.hypot(fwd, side);
    if (len > 0) { fwd /= len; side /= len; }

    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    const target = len > 0 ? (running ? RUN_SPEED : WALK_SPEED) : 0;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // yaw 0 looks down -Z, the three.js convention
    const dirX = (-sin * fwd) + (cos * side);
    const dirZ = (-cos * fwd) + (-sin * side);

    const wantX = dirX * target;
    const wantZ = dirZ * target;
    const a = Math.min(1, ACCEL * dt);
    this.velocity.x += (wantX - this.velocity.x) * a;
    this.velocity.z += (wantZ - this.velocity.z) * a;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    const ground = groundHeightAt(this.position.x, this.position.z);
    this.position.y = ground;
    if (this.smoothGround === null) this.smoothGround = ground;
    this.smoothGround += (ground - this.smoothGround) * Math.min(1, 14 * dt);

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.bobPhase += this.speed * dt * 1.9;
    const bob = Math.sin(this.bobPhase * 2) * 0.022 * Math.min(1, this.speed / WALK_SPEED);
    const sway = Math.sin(this.bobPhase) * 0.014 * Math.min(1, this.speed / WALK_SPEED);

    camera.position.set(
      this.position.x + sway * cos,
      this.smoothGround + this.eye + bob,
      this.position.z - sway * sin,
    );
    camera.rotation.set(0, 0, 0);
    camera.rotateY(this.yaw);
    camera.rotateX(this.pitch);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
