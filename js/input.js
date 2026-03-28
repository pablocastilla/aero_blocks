/**
 * input.js — Unified Pointer/Touch/Mouse Input Manager
 *
 * Uses the PointerEvents API for a single handler covering mouse,
 * touch, and stylus. Falls back to touchstart/mousedown events.
 *
 * All coordinates are converted to "virtual" space (1600×900).
 */

'use strict';

class InputManager {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} virtualW  Virtual coordinate space width
   * @param {number} virtualH  Virtual coordinate space height
   */
  constructor(canvas, virtualW, virtualH) {
    this.canvas   = canvas;
    this.vW       = virtualW;
    this.vH       = virtualH;

    // Scale & offset set by updateTransform()
    this.scale    = 1;
    this.offsetX  = 0;
    this.offsetY  = 0;

    // Current drag state
    this._drag = {
      active:    false,
      pointerId: null,
      startVX:   0, startVY: 0,   // virtual start position
      currentVX: 0, currentVY: 0, // virtual current position
      deltaVX:   0, deltaVY: 0,   // delta since last event
    };

    // Two-finger state for rotate gesture (mobile)
    this._pointers = new Map(); // pointerId → {x, y} in SCREEN coords
    this._prevAngle = null;     // angle between two fingers last frame

    // Keyboard modifiers
    this._shiftDown = false;

    // Rotate mode — when true, single-finger drag rotates instead of moves
    this._rotateMode = false;

    // Callbacks (set from outside via on___())
    this._onDragStart  = null;
    this._onDragMove   = null;
    this._onDragEnd    = null;
    this._onRotate     = null;  // (angleDeltaDeg) → void

    this._bind();
  }

  // ── PUBLIC API ─────────────────────────────────────────────────

  /** Call after canvas resize to keep coordinate mapping accurate */
  updateTransform(scale, offsetX, offsetY) {
    this.scale   = scale;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
  }

  setRotateMode(v) { this._rotateMode = !!v; }
  isRotateMode()   { return this._rotateMode; }

  onDragStart(fn)  { this._onDragStart = fn; }
  onDragMove(fn)   { this._onDragMove  = fn; }
  onDragEnd(fn)    { this._onDragEnd   = fn; }
  onRotate(fn)     { this._onRotate    = fn; }  // fired for two-finger + shift+drag

  /** Convert screen pixels → virtual coords */
  toVirtual(screenX, screenY) {
    return {
      x: (screenX - this.offsetX) / this.scale,
      y: (screenY - this.offsetY) / this.scale,
    };
  }

  /** Get current drag state (virtual coords) */
  getDrag() { return { ...this._drag }; }

  /** Is shift key held (for rotation on desktop) */
  isShiftDown() { return this._shiftDown; }

  destroy() {
    this._unbind();
  }

  // ── PRIVATE ────────────────────────────────────────────────────

  _bind() {
    const c = this.canvas;

    // PointerEvents — covers mouse, touch, pen in one API
    c.addEventListener('pointerdown',   this._onDown.bind(this),   { passive: false });
    c.addEventListener('pointermove',   this._onMove.bind(this),   { passive: false });
    c.addEventListener('pointerup',     this._onUp.bind(this),     { passive: false });
    c.addEventListener('pointercancel', this._onUp.bind(this),     { passive: false });
    c.addEventListener('pointerleave',  this._onLeave.bind(this),  { passive: false });

    // Prevent context menu on long-press (mobile) / right-click
    c.addEventListener('contextmenu', e => e.preventDefault());

    // Keyboard (desktop rotate with Shift)
    window.addEventListener('keydown', this._onKey.bind(this));
    window.addEventListener('keyup',   this._onKey.bind(this));

    // Scroll-wheel rotate (desktop)
    c.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
  }

  _unbind() {
    // Mirror of _bind() — call before destroy
    const c = this.canvas;
    c.removeEventListener('pointerdown',   this._onDown);
    c.removeEventListener('pointermove',   this._onMove);
    c.removeEventListener('pointerup',     this._onUp);
    c.removeEventListener('pointercancel', this._onUp);
    c.removeEventListener('pointerleave',  this._onLeave);
    window.removeEventListener('keydown',  this._onKey);
    window.removeEventListener('keyup',    this._onKey);
    c.removeEventListener('wheel',         this._onWheel);
  }

  _onDown(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);

    const pos = this._screenPos(e);
    this._pointers.set(e.pointerId, pos);

    if (this._pointers.size === 2) {
      // Start two-finger gesture — capture initial angle
      this._prevAngle = this._twoFingerAngle();
      // Cancel any solo drag
      if (this._drag.active) {
        this._drag.active = false;
        if (this._onDragEnd) this._onDragEnd(this._drag);
      }
      return;
    }

    // Single pointer → start drag
    const vpos = this.toVirtual(pos.x, pos.y);
    this._drag = {
      active:    true,
      pointerId: e.pointerId,
      startVX:   vpos.x, startVY: vpos.y,
      currentVX: vpos.x, currentVY: vpos.y,
      deltaVX:   0,       deltaVY:  0,
      rotateMode: this._rotateMode || this._shiftDown,
    };
    if (this._onDragStart) this._onDragStart({ ...this._drag });
  }

  _onMove(e) {
    e.preventDefault();
    const pos = this._screenPos(e);
    this._pointers.set(e.pointerId, pos);

    // ── Two-finger rotation ──────────────────
    if (this._pointers.size === 2) {
      const newAngle = this._twoFingerAngle();
      if (this._prevAngle !== null) {
        let delta = newAngle - this._prevAngle;
        // Wrap delta to (-180, 180)
        if (delta > 180)  delta -= 360;
        if (delta < -180) delta += 360;
        if (Math.abs(delta) < 60 && this._onRotate) {  // sanity clamp
          this._onRotate(delta);
        }
      }
      this._prevAngle = newAngle;
      return;
    }

    this._prevAngle = null;

    // ── Single-finger drag ───────────────────
    if (!this._drag.active || e.pointerId !== this._drag.pointerId) return;

    const vpos = this.toVirtual(pos.x, pos.y);
    const prevVX = this._drag.currentVX;
    const prevVY = this._drag.currentVY;

    this._drag.currentVX = vpos.x;
    this._drag.currentVY = vpos.y;
    this._drag.deltaVX   = vpos.x - prevVX;
    this._drag.deltaVY   = vpos.y - prevVY;
    this._drag.rotateMode = this._rotateMode || this._shiftDown;

    if (this._onDragMove) this._onDragMove({ ...this._drag });
  }

  _onUp(e) {
    e.preventDefault();
    this.canvas.releasePointerCapture(e.pointerId);
    this._pointers.delete(e.pointerId);
    this._prevAngle = null;

    if (!this._drag.active || e.pointerId !== this._drag.pointerId) return;

    this._drag.active = false;
    if (this._onDragEnd) this._onDragEnd({ ...this._drag });
  }

  _onLeave(e) {
    // Treat pointer-leave as pointer-up for primary drag
    if (this._drag.active && e.pointerId === this._drag.pointerId) {
      this._drag.active = false;
      this._pointers.delete(e.pointerId);
      if (this._onDragEnd) this._onDragEnd({ ...this._drag });
    }
  }

  _onKey(e) {
    this._shiftDown = e.shiftKey;
    // Update active drag's rotateMode state live
    if (this._drag.active) {
      this._drag.rotateMode = this._rotateMode || this._shiftDown;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    // Scroll wheel triggers rotation at hit position
    if (this._onRotate) {
      // Positive deltaY = scroll down = rotate clockwise
      const deg = e.deltaY * 0.15;
      this._onRotate(deg);
    }
  }

  /** Raw screen position from a PointerEvent */
  _screenPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Angle (degrees) between the two active pointer positions */
  _twoFingerAngle() {
    const pts = [...this._pointers.values()];
    if (pts.length < 2) return 0;
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    return Math.atan2(dy, dx) * (180 / Math.PI);
  }
}
