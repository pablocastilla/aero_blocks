/**
 * sandbox.js — Wind Tunnel Sandbox (Free-Play Mode)
 *
 * Freehand pencil drawing of shapes with real-time aerodynamic
 * calculations using a 2D panel method (Bernoulli pressure integration).
 *
 * HUD: only Drag (Cd) and Downforce (Cl)
 * No floor — particles flow freely through an open tunnel.
 *
 * Depends on: profiles.js, physics.js, renderer.js, levels.js (TUNNEL const)
 */

'use strict';

// ── AERO CONSTANTS ─────────────────────────────────────────────
const SANDBOX_AIR_DENSITY  = 1.225;   // kg/m³ sea level
const SANDBOX_SCALE        = 0.01;    // 1 virtual unit ≈ 1 cm
const SANDBOX_DEFAULT_WIND = 30;      // m/s (~108 km/h)
const SANDBOX_WIND_MIN     = 5;
const SANDBOX_WIND_MAX     = 80;

// ── SANDBOX MODE CLASS ─────────────────────────────────────────

class SandboxMode {
  constructor(canvas, renderer, inputManager) {
    this.canvas    = canvas;
    this.renderer  = renderer;
    this.input     = inputManager;

    // All user-drawn shapes: array of { points: [{x,y}...], closed: bool }
    this.shapes       = [];
    this._currentDraw = null;  // shape currently being drawn (not yet closed)
    this._isDrawing   = false;

    // Aero results (updated each frame)
    this.aeroResult = { Cd: 0, Cl: 0, dragN: 0, downforceN: 0 };

    // Wind speed (m/s real-world)
    this.windSpeedMs   = SANDBOX_DEFAULT_WIND;
    // Particle wind speed (virtual units/s) — mapped from real
    this.particleSpeed = this._windToParticleSpeed(SANDBOX_DEFAULT_WIND);

    // Particle system
    this.particles = null;

    // Smoothing for drawn lines
    this._minPointDist = 3;  // min distance between samples (virtual units) — low for smooth curves

    // Panel method sampling
    this._velocityGrid     = null;
    this._velocityGridTime = 0;

    // Time
    this._time = 0;
  }

  // ── LIFECYCLE ──────────────────────────────────────────────────

  enter() {
    this.shapes       = [];
    this._currentDraw = null;
    this._isDrawing   = false;
    this.aeroResult   = { Cd: 0, Cl: 0, dragN: 0, downforceN: 0 };

    // Create particle system — no gravity, no floor, wall bounce on ceiling only
    const count = Math.max(350, Math.round(
      (navigator.hardwareConcurrency || 2) >= 4 ? 420 : 300
    ));

    // Use full virtual viewport for particles (not just TUNNEL)
    // V_W=1600, V_H=900 — spawn across entire height so mobile looks full
    this.particles = new ParticleSystem({
      count:        count,
      spawnX:       0,
      spawnBandY:   450,        // Center of the screen
      spawnBandH:   900,        // Full height spread
      windSpeed:    this.particleSpeed,
      gravity:      0,
      wallBounce:   false,        // no floor/ceiling bounce — open tunnel
      trailLength:  40,           // Long trails to look like wind tunnel stream lines
      tunnelBounds: {
        x: -100,
        y: -100,
        w: 1800,
        h: 1100,
      },
    });
  }

  exit() {
    this.particles = null;
    this.shapes    = [];
  }

  // ── INPUT HANDLING ─────────────────────────────────────────────

  onPointerDown(vx, vy) {
    // Check if tapping an existing shape to delete (double-tap / right-click handled elsewhere)
    // Start freehand drawing
    this._isDrawing   = true;
    this._currentDraw = { points: [{ x: vx, y: vy }], closed: false };
  }

  onPointerMove(vx, vy) {
    if (!this._isDrawing || !this._currentDraw) return;

    const pts  = this._currentDraw.points;
    const last = pts[pts.length - 1];
    const dx   = vx - last.x;
    const dy   = vy - last.y;

    // Only add point if far enough from last (reduces noise)
    if (dx * dx + dy * dy >= this._minPointDist * this._minPointDist) {
      pts.push({ x: vx, y: vy });
    }
  }

  onPointerUp(vx, vy) {
    if (!this._isDrawing || !this._currentDraw) return;
    this._isDrawing = false;

    const pts = this._currentDraw.points;

    // Add final point
    if (pts.length > 0) {
      const last = pts[pts.length - 1];
      if (Math.abs(vx - last.x) > 1 || Math.abs(vy - last.y) > 1) {
        pts.push({ x: vx, y: vy });
      }
    }

    // Need at least 5 points for a meaningful shape
    if (pts.length < 5) {
      this._currentDraw = null;
      return;
    }

    // Smooth the path
    const smoothed = this._smoothPath(pts);

    // Close the shape (connect last → first)
    smoothed.push({ ...smoothed[0] });

    const shape = { points: smoothed, closed: true };
    this.shapes.push(shape);
    this._currentDraw = null;

    // Rebuild physics obstacles from shapes
    this._rebuildObstacles();
  }

  clearAllShapes() {
    this.shapes       = [];
    this._currentDraw = null;
    this._isDrawing   = false;
    this._rebuildObstacles();
  }

  undoLastShape() {
    if (this.shapes.length > 0) {
      this.shapes.pop();
      this._rebuildObstacles();
    }
  }

  setWindSpeed(ms) {
    this.windSpeedMs   = Math.max(SANDBOX_WIND_MIN, Math.min(SANDBOX_WIND_MAX, ms));
    this.particleSpeed = this._windToParticleSpeed(this.windSpeedMs);
    if (this.particles) {
      this.particles.windSpeed = this.particleSpeed;
    }
  }

  // ── UPDATE ─────────────────────────────────────────────────────

  update(dt) {
    this._time += dt;

    if (this.particles) {
      // Build profile objects from closed shapes for Coanda interaction
      this.particles.update(dt);
    }

    // Compute aero every ~100ms (not every frame — expensive)
    if (this._time - this._velocityGridTime > 0.1) {
      this._velocityGridTime = this._time;
      this._computeAero();
    }
  }

  // ── AERODYNAMIC CALCULATIONS ───────────────────────────────────

  /**
   * 2D Panel Method — Bernoulli pressure integration.
   * 
   * For each closed shape:
   *   1. Discretize boundary into panels (line segments)
   *   2. For each panel, sample nearby particle velocities to estimate local flow speed
   *   3. Compute pressure coefficient: Cp = 1 - (V_local / V_freestream)²
   *   4. Integrate force = Σ (Cp × ½ρV² × panel_length × panel_normal)
   *   5. Decompose into drag (x-component) and lift/downforce (y-component)
   */
  _computeAero() {
    if (this.shapes.length === 0 || !this.particles) {
      this.aeroResult = { Cd: 0, Cl: 0, dragN: 0, downforceN: 0 };
      return;
    }

    const particles = this.particles.particles;
    const V_inf     = this.particleSpeed;  // freestream in virtual units/s
    const V_inf_ms  = this.windSpeedMs;
    const rho       = SANDBOX_AIR_DENSITY;
    const q_inf     = 0.5 * rho * V_inf_ms * V_inf_ms;  // dynamic pressure (Pa)

    let totalDragForce = 0;
    let totalLiftForce = 0;
    let totalFrontalArea = 0;

    for (const shape of this.shapes) {
      if (!shape.closed || shape.points.length < 4) continue;

      const pts    = shape.points;
      const nPanels = pts.length - 1;

      // Compute frontal area (height projection in y)
      let minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const frontalH = (maxY - minY) * SANDBOX_SCALE;  // meters

      // Also get reference chord (width projection in x)
      let minX = Infinity, maxX = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }
      const chord = (maxX - minX) * SANDBOX_SCALE;

      if (frontalH < 0.01 || chord < 0.01) continue;

      totalFrontalArea += frontalH;  // per-unit-depth (2D)

      let shapeDrag = 0;
      let shapeLift = 0;

      for (let i = 0; i < nPanels; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];

        // Panel midpoint and length
        const mx = (p1.x + p2.x) * 0.5;
        const my = (p1.y + p2.y) * 0.5;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const panelLen = Math.sqrt(dx * dx + dy * dy);
        if (panelLen < 0.5) continue;

        // Outward normal (assuming CCW winding — we'll check)
        let nx = -dy / panelLen;  // perpendicular to panel
        let ny =  dx / panelLen;

        // Ensure normal points outward (away from shape centroid)
        const cx = shape._centroidX || 0;
        const cy = shape._centroidY || 0;
        const toCenter_x = cx - mx;
        const toCenter_y = cy - my;
        if (nx * toCenter_x + ny * toCenter_y > 0) {
          nx = -nx;
          ny = -ny;
        }

        // Sample local velocity: find particles near this panel midpoint
        const sampleRadius = 50;  // virtual units
        let sumVx = 0, sumVy = 0, count = 0;
        for (const p of particles) {
          if (!p.active) continue;
          const pdx = p.x - mx;
          const pdy = p.y - my;
          if (pdx * pdx + pdy * pdy < sampleRadius * sampleRadius) {
            sumVx += p.vx;
            sumVy += p.vy;
            count++;
          }
        }

        let Cp;
        if (count >= 2) {
          const localVx = sumVx / count;
          const localVy = sumVy / count;
          const localSpeed = Math.sqrt(localVx * localVx + localVy * localVy);
          const speedRatio = localSpeed / V_inf;
          Cp = 1 - speedRatio * speedRatio;
        } else {
          // Stagnation assumption for panels with no nearby particles
          // Check if this panel faces the wind
          const facingWind = nx < -0.3;  // normal points upstream
          Cp = facingWind ? 0.9 : -0.2;
        }

        // Force on this panel: F = Cp × q∞ × panelLength × normal
        const panelLenM = panelLen * SANDBOX_SCALE;
        const force = Cp * q_inf * panelLenM;

        // Decompose: drag = force component in x direction, lift = in -y direction
        shapeDrag += force * (-nx);  // drag is force opposing flow (into +x)
        shapeLift += force * ( ny);  // lift is force in -y direction (upward)
      }

      // Add skin friction drag (turbulent flat plate estimate)
      const Re = (V_inf_ms * chord) / 1.5e-5;  // kinematic viscosity of air
      if (Re > 100) {
        const Cf = 0.074 / Math.pow(Re, 0.2);
        const wettedLen = nPanels > 0 
          ? pts.reduce((sum, p, i) => {
              if (i === 0) return 0;
              const ddx = p.x - pts[i-1].x;
              const ddy = p.y - pts[i-1].y;
              return sum + Math.sqrt(ddx*ddx + ddy*ddy);
            }, 0) * SANDBOX_SCALE
          : 0;
        shapeDrag += Cf * q_inf * wettedLen;
      }

      totalDragForce += shapeDrag;
      totalLiftForce += shapeLift;
    }

    // Coefficients
    const refArea = Math.max(0.01, totalFrontalArea);
    const Cd = totalDragForce / (q_inf * refArea);
    const Cl = -totalLiftForce / (q_inf * refArea);  // Downforce coefficient (negative lift)

    this.aeroResult = {
      Cd: Math.max(0, Cd),
      Cl: Cl,
      dragN:      totalDragForce,
      downforceN: -totalLiftForce,  // positive downforce = negative lift
    };
  }

  // ── PHYSICS INTEGRATION ────────────────────────────────────────

  /**
   * Convert closed shapes into Profile objects for the particle system's
   * Coanda interaction, plus wall obstacles for solid-body collision.
   */
  _rebuildObstacles() {
    if (!this.particles) return;

    const profiles  = [];
    const obstacles = [];

    for (const shape of this.shapes) {
      if (!shape.closed || shape.points.length < 4) continue;

      // Compute centroid for normal orientation
      let cx = 0, cy = 0;
      for (const p of shape.points) { cx += p.x; cy += p.y; }
      cx /= shape.points.length;
      cy /= shape.points.length;
      shape._centroidX = cx;
      shape._centroidY = cy;

      // Create profiles from shape segments for Coanda effect
      // Break shape into overlapping arcs of ~8-12 points each
      const pts = shape.points;
      const segLen = 10;
      const step   = Math.max(1, Math.floor(segLen * 0.6));

      for (let start = 0; start < pts.length - 1; start += step) {
        const end = Math.min(start + segLen, pts.length);
        if (end - start < 3) continue;

        const segPts = pts.slice(start, end);
        const profile = this._createProfileFromPoints(segPts);
        if (profile) profiles.push(profile);
      }
    }

    this.particles.setProfiles(profiles);
    this.particles.setObstacles(obstacles);
  }

  /**
   * Create a Profile-like object from a sequence of world-space points.
   * We create a lightweight duck-typed object that matches the Profile 
   * interface expected by the particle system (nearestPoint, getWorldPoints).
   */
  _createProfileFromPoints(pts) {
    if (pts.length < 3) return null;

    // Pre-compute tangents
    const worldPts = pts.map((p, i) => {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const dx   = next.x - prev.x;
      const dy   = next.y - prev.y;
      const len  = Math.sqrt(dx * dx + dy * dy) || 1;
      return { x: p.x, y: p.y, tx: dx / len, ty: dy / len };
    });

    // Compute center
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length;
    cy /= pts.length;

    return {
      x: cx,
      y: cy,
      draggable: false,
      _worldPts: worldPts,

      getWorldPoints() {
        return this._worldPts;
      },

      nearestPoint(px, py) {
        const wpts = this._worldPts;
        let minDist = Infinity;
        let nearest = null;
        let nearIdx = 0;

        for (let i = 0; i < wpts.length; i++) {
          const ddx = px - wpts[i].x;
          const ddy = py - wpts[i].y;
          const d   = ddx * ddx + ddy * ddy;
          if (d < minDist) {
            minDist = d;
            nearest = wpts[i];
            nearIdx = i;
          }
        }

        const dist = Math.sqrt(minDist);
        let nx, ny;
        if (dist > 0.001) {
          nx = (px - nearest.x) / dist;
          ny = (py - nearest.y) / dist;
        } else {
          nx = -nearest.ty;
          ny = nearest.tx;
        }

        return {
          point: { x: nearest.x, y: nearest.y },
          dist,
          tx: nearest.tx, ty: nearest.ty,
          nx, ny,
          tCurve: wpts.length > 1 ? nearIdx / (wpts.length - 1) : 0.5,
        };
      },

      hitTest() { return false; },
    };
  }

  // ── DRAWING HELPERS ────────────────────────────────────────────

  /**
   * Smooth a freehand path using Chaikin's corner-cutting algorithm.
   */
  _smoothPath(pts) {
    if (pts.length < 3) return pts;

    // Apply 3 iterations of Chaikin smoothing for very smooth curves
    let result = pts.slice();
    for (let iter = 0; iter < 3; iter++) {
      const smoothed = [];
      for (let i = 0; i < result.length - 1; i++) {
        const p0 = result[i];
        const p1 = result[i + 1];
        smoothed.push({
          x: p0.x * 0.75 + p1.x * 0.25,
          y: p0.y * 0.75 + p1.y * 0.25,
        });
        smoothed.push({
          x: p0.x * 0.25 + p1.x * 0.75,
          y: p0.y * 0.25 + p1.y * 0.75,
        });
      }
      result = smoothed;
    }

    // Downsample if too many points (keep ~150 max for performance)
    const maxPts = 150;
    if (result.length > maxPts) {
      const step = result.length / maxPts;
      const down = [];
      for (let i = 0; i < maxPts; i++) {
        down.push(result[Math.floor(i * step)]);
      }
      result = down;
    }

    return result;
  }

  // ── WIND CONVERSION ────────────────────────────────────────────

  _windToParticleSpeed(ms) {
    // Map real-world m/s to virtual units/s
    // Make the particles move extremely fast to look like a wind tunnel
    return ms * 22;
  }

  // ── GETTERS FOR RENDERER ───────────────────────────────────────

  getDrawState() {
    return {
      shapes:         this.shapes,
      currentDraw:    this._currentDraw,
      isDrawing:      this._isDrawing,
      aeroResult:     this.aeroResult,
      particles:      this.particles ? this.particles.particles : [],
      windSpeedMs:    this.windSpeedMs,
      time:           this._time,
    };
  }
}
