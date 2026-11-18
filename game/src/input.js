// input.js — keyboard + mouse state for Solmar Heat.
// WASD/arrows move and drive, mouse drag orbits the camera, click shoots.
// Edge-triggered actions (E, F, R, M, P) are consumed by main.js each frame.

export class Input {
  constructor() {
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.clicked = false;
    this.dragging = false;
    this.pressed = new Set(); // edge-triggered keys, cleared by consume()
    this.onFirstGesture = null;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (this.onFirstGesture) { this.onFirstGesture(); this.onFirstGesture = null; }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.clicked = true;
      if (this.onFirstGesture) { this.onFirstGesture(); this.onFirstGesture = null; }
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.dragging = false;
    });
  }

  get up() { return this.keys.has('KeyW') || this.keys.has('ArrowUp'); }
  get down() { return this.keys.has('KeyS') || this.keys.has('ArrowDown'); }
  get left() { return this.keys.has('KeyA') || this.keys.has('ArrowLeft'); }
  get right() { return this.keys.has('KeyD') || this.keys.has('ArrowRight'); }
  get run() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
  get handbrake() { return this.keys.has('Space'); }

  /** True once per physical key press. */
  consume(code) {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  /** Mouse drag delta since last call, then cleared. */
  takeMouseDelta() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  takeClick() {
    const c = this.clicked;
    this.clicked = false;
    return c;
  }
}
