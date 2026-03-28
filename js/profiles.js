/**
 * profiles.js — Aerodynamic Profile Shapes
 *
 * Defines profile shapes as sequences of local-space points.
 * A Profile transforms those points by its (x, y, angle) to world-
 * (virtual-) space, then exposes them for physics & rendering.
 *
 * Virtual coordinate space: 1600 × 900, origin top-left, y increases DOWN.
 * Wind blows in the +x direction.
 */

'use strict';

// ═══════════════════════════════════════════════════════════
// SHAPE DEFINITIONS  (local space, centred at 0,0)
// ═══════════════════════════════════════════════════════════

/** Generate a concave-arc shape ("deflector / flap").
 *  span: total width in virtual units
 *  depth: curve depth (how far mid-point is offset from the chord line)
 *  n: number of samples
 *
 *  When horizontal (angle=0), the concave side faces downward (positive y).
 *  Air flowing along the CONCAVE side (underneath) curves downward at the exit.
 *  Air flowing along the CONVEX side (topside) curves upward at the exit.
 *  Rotate the profile to aim the exit tangent toward the target.
 */
function _makeArc(span = 200, depth = 50, n = 20) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = -span / 2 + t * span;
    // Parabolic: depth at t=0.5, 0 at ends
    const y = depth * (4 * t * (1 - t));
    pts.push({ x, y });
  }
  return pts;
}

/** Generate a cambered airfoil camber-line (asymmetric).
 *  length: chord length
 *  camber: max camber (0 = symmetric/flat plate, +30 = quite cambered)
 *  n: samples
 *
 *  The camber bows toward negative y (visual "up").
 *  Air following the positive-y (lower) side curves toward negative-y.
 */
function _makeFoil(length = 230, camber = 40, n = 22) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t  = i / n;
    const x  = -length / 2 + t * length;
    // NACA-style camber curve: peaks around t = 0.4
    const y  = -(4 * camber * t * (1 - t));
    pts.push({ x, y });
  }
  return pts;
}

/** Thin cambered wing element used by the F1 tunnel view.
 *  Less exaggerated than the gameplay foil so it reads as a wing, not a flap.
 */
function _makeWing(length = 210, camber = 18, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = -length * 0.34 + t * length;
    const y = (4 * camber * t * (1 - t)) * (0.78 - 0.28 * t);
    pts.push({ x, y });
  }
  return pts;
}

/** Flat plate — straight horizontal line. Splits the flow cleanly. */
function _makeFlat(length = 200, n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    pts.push({ x: -length / 2 + (i / n) * length, y: 0 });
  }
  return pts;
}

/** Short rounded-tip guide vane — useful for tight deflections */
function _makeVane(length = 140, curvature = 30, n = 16) {
  return _makeArc(length, curvature, n);
}

// Pre-built shape tables
const PROFILE_SHAPES = {
  arc:   _makeArc(260, 65, 22),
  foil:  _makeFoil(230, 42, 22),
  wing:  _makeWing(210, 18, 28),
  flat:  _makeFlat(200, 14),
  vane:  _makeVane(140, 32, 16),
};

// ═══════════════════════════════════════════════════════════
// PROFILE CLASS
// ═══════════════════════════════════════════════════════════

class Profile {
  /**
   * @param {object} cfg
  * @param {string}  cfg.type       – 'arc' | 'foil' | 'wing' | 'flat' | 'vane'
   * @param {number}  cfg.x          – virtual x of profile centre
   * @param {number}  cfg.y          – virtual y of profile centre
   * @param {number}  [cfg.angle]    – degrees, clockwise from +x axis (0 = horizontal)
   * @param {boolean} [cfg.draggable]– true by default
   * @param {number}  [cfg.minX]     – drag boundary
   * @param {number}  [cfg.maxX]
   * @param {number}  [cfg.minY]
   * @param {number}  [cfg.maxY]
   */
  constructor(cfg) {
    this.type      = cfg.type || 'arc';
    this.x         = cfg.x;
    this.y         = cfg.y;
    this.angle     = cfg.angle || 0;   // degrees CW
    this.draggable = cfg.draggable !== false;

    // Drag bounds (optional, in virtual coords)
    this.minX = cfg.minX !== undefined ? cfg.minX : 80;
    this.maxX = cfg.maxX !== undefined ? cfg.maxX : 1520;
    this.minY = cfg.minY !== undefined ? cfg.minY : 80;
    this.maxY = cfg.maxY !== undefined ? cfg.maxY : 820;

    // Cache
    this._localPts  = PROFILE_SHAPES[this.type];
    this._worldPts  = null;   // [{ x, y, tx, ty }]
    this._dirty     = true;
  }

  // ── GEOMETRY ─────────────────────────────────────────────

  /** Get world-space sampled points with tangents.
   *  Returns array of { x, y, tx, ty } (tangent is unit vector).
   */
  getWorldPoints() {
    if (!this._dirty && this._worldPts) return this._worldPts;

    const rad  = this.angle * (Math.PI / 180);
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    const lp   = this._localPts;
    const out  = new Array(lp.length);

    // Transform local → world
    for (let i = 0; i < lp.length; i++) {
      const lx = lp[i].x;
      const ly = lp[i].y;
      out[i] = {
        x:  cosA * lx - sinA * ly + this.x,
        y:  sinA * lx + cosA * ly + this.y,
        tx: 0, ty: 0,
      };
    }

    // Compute tangents from finite differences
    for (let i = 0; i < out.length; i++) {
      const prev = out[Math.max(0, i - 1)];
      const next = out[Math.min(out.length - 1, i + 1)];
      const dx   = next.x - prev.x;
      const dy   = next.y - prev.y;
      const len  = Math.sqrt(dx * dx + dy * dy) || 1;
      out[i].tx  = dx / len;
      out[i].ty  = dy / len;
    }

    this._worldPts = out;
    this._dirty    = false;
    return out;
  }

  /**
   * Find the nearest point on this profile to (px, py).
   * Returns { point, dist, tx, ty, normal } — all in virtual space.
   * normal: unit vector from surface toward the query point.
   */
  nearestPoint(px, py) {
    const pts    = this.getWorldPoints();
    if (!pts || pts.length === 0) {
      return { point: {x: this.x, y: this.y}, dist: Infinity, tx: 1, ty: 0, nx: 0, ny: -1, tCurve: 0.5 };
    }
    let minDist  = Infinity;
    let nearest  = null;
    let nearIdx  = 0;

    for (let i = 0; i < pts.length; i++) {
      const dx = px - pts[i].x;
      const dy = py - pts[i].y;
      const d  = dx * dx + dy * dy; // squared distance for speed
      if (d < minDist) {
        minDist = d;
        nearest = pts[i];
        nearIdx = i;
      }
    }

    const dist = Math.sqrt(minDist);

    // Normal from surface to query point
    let nx, ny;
    if (dist > 0.001) {
      nx = (px - nearest.x) / dist;
      ny = (py - nearest.y) / dist;
    } else {
      // Degenerate — use outward normal from tangent
      nx = -nearest.ty;
      ny = nearest.tx;
    }

    return {
      point:  { x: nearest.x, y: nearest.y },
      dist,
      tx: nearest.tx, ty: nearest.ty,   // surface tangent
      nx, ny,                            // outward normal (toward particle)
      tCurve: pts.length > 1 ? nearIdx / (pts.length - 1) : 0.5,  // 0‑1 position along profile
    };
  }

  /**
   * Hit-test: is virtual point (px, py) within `radius` of this profile?
   * Used to detect which profile a pointer starts on.
   */
  hitTest(px, py, radius = 40) {
    if (!this.draggable) return false;
    const { dist } = this.nearestPoint(px, py);
    return dist <= radius;
  }

  // ── TRANSFORMS ───────────────────────────────────────────

  move(dx, dy) {
    this.x = Math.max(this.minX, Math.min(this.maxX, this.x + dx));
    this.y = Math.max(this.minY, Math.min(this.maxY, this.y + dy));
    this._dirty = true;
  }

  rotateDeg(delta) {
    this.angle = (this.angle + delta) % 360;
    if (this.angle < 0) this.angle += 360;
    this._dirty = true;
  }

  setAngle(deg) {
    this.angle  = deg % 360;
    this._dirty = true;
  }

  setPosition(x, y) {
    this.x = Math.max(this.minX, Math.min(this.maxX, x));
    this.y = Math.max(this.minY, Math.min(this.maxY, y));
    this._dirty = true;
  }

  /** Get bounding box { x, y, w, h } in virtual coords */
  getBounds() {
    const pts = this.getWorldPoints();
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of pts) {
      if (p.x < x1) x1 = p.x;
      if (p.y < y1) y1 = p.y;
      if (p.x > x2) x2 = p.x;
      if (p.y > y2) y2 = p.y;
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /** Clone to a fresh Profile instance */
  clone() {
    return new Profile({
      type:      this.type,
      x:         this.x,
      y:         this.y,
      angle:     this.angle,
      draggable: this.draggable,
      minX: this.minX, maxX: this.maxX,
      minY: this.minY, maxY: this.maxY,
    });
  }
}
