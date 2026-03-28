/**
 * physics.js — Particle System & Coanda Effect Engine
 *
 * Simulates 200-400 particles (adaptive for mobile) streaming
 * left-to-right through a virtual 1600×900 wind tunnel.
 *
 * The Coanda effect: particles near a profile surface are:
 *   1. Attracted toward the surface (normal force)
 *   2. Re-oriented to follow the surface tangent
 *   3. Prevented from penetrating (surface collision)
 *
 * All coordinates in virtual space (1600 × 900).
 */

'use strict';

// ── CONSTANTS ──────────────────────────────────────────────────
const COANDA_RADIUS    = 110;  // Virtual units — Coanda influence bubble
const ATTRACTION       = 1100; // units/s² — Pull toward surface
const TANGENT_RATE     = 6.0;  // per-sec — How fast velocity aligns with tangent
const SURFACE_MIN      = 7;    // units — Minimum particle-to-surface distance
const MAX_SPEED        = 420;  // units/s — Speed cap
const WIND_SPREAD      = 0.06; // fraction of base speed added as y-noise
const PARTICLE_SIZE    = 2;    // Stored for renderer to use
const GRAVITY          = 8;    // virtual units/s² — gentle downward pull

const F1_LAYOUT = Object.freeze({
  baseX: 500,
  referenceY: 530,
  nosePivotX: 28,
  rearWingX: 700,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── PARTICLE CLASS ─────────────────────────────────────────────

class Particle {
  constructor() {
    this.x  = 0; this.y  = 0;
    this.vx = 0; this.vy = 0;
    this.life   = 1;    // 0-1, used for opacity
    this.active = false;
    // Trail: array of {x, y} capturing last N positions
    this.trail  = [];
    this.TRAIL_LEN = 5;
  }

  setTrailLength(len) {
    this.TRAIL_LEN = Math.max(2, Math.floor(len || 2));
    if (this.trail.length > this.TRAIL_LEN) {
      this.trail = this.trail.slice(-this.TRAIL_LEN);
    }
  }

  /** Spawn at left edge with slight y-spread around spawn band */
  spawn(spawnX, spawnBandY, spawnBandH, windSpeed) {
    this.x    = spawnX + Math.random() * 20;
    this.y    = spawnBandY + (Math.random() - 0.5) * spawnBandH;
    this.vx   = windSpeed * (0.85 + Math.random() * 0.3);
    this.vy   = windSpeed * (Math.random() - 0.5) * WIND_SPREAD;
    this.life = 0.7 + Math.random() * 0.3;
    this.active = true;
    this.trail  = [];
  }

  /** Main update — dt in seconds, profiles array for Coanda.
   *  gravity: virtual units/s² (pass 0 for wind-tunnel mode) */
  update(dt, profiles, obstacles, tunnelBounds, gravity) {
    if (!this.active) return;

    // Record trail position before moving
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > this.TRAIL_LEN) this.trail.shift();

    // ── Coanda interaction ───────────────────────────────
    for (const profile of profiles) {
      const { dist, tx, ty, nx, ny, tCurve } = profile.nearestPoint(this.x, this.y);

      if (dist > COANDA_RADIUS) continue;

      // Edge fade: no Coanda at profile endpoints (trailing-edge separation)
      const edgeFade = Math.min(tCurve * 5, (1 - tCurve) * 5, 1);
      if (edgeFade < 0.01) continue;

      // Anti-orbit: only apply Coanda to forward-moving particles
      // Particles flowing backward (negative vx) have reversed due to orbiting
      const fwdFade = Math.max(0, Math.min(1, this.vx / 50));
      if (fwdFade < 0.01) continue;

      const t = 1 - dist / COANDA_RADIUS;   // 0 at edge → 1 at centre
      const fade = edgeFade * fwdFade;

      // 1. Normal attraction: pull toward surface
      const attractF = ATTRACTION * t * t * fade;
      this.vx -= nx * attractF * dt;
      this.vy -= ny * attractF * dt;

      // 2. Velocity tangentialization (re-orient to follow curve)
      if (dist < COANDA_RADIUS * 0.6 && fade > 0.1) {
        // Choose tangent direction that aligns with current velocity
        const dot = this.vx * tx + this.vy * ty;
        // Tangent in the direction particle is moving along surface
        const tDirX = dot >= 0 ? tx : -tx;
        const tDirY = dot >= 0 ? ty : -ty;

        // Gradually rotate velocity toward tangent
        const alpha = Math.min(1, t * TANGENT_RATE * dt * fade);
        const speed2 = Math.sqrt(this.vx * this.vx + this.vy * this.vy) || 1;
        this.vx = this.vx * (1 - alpha) + tDirX * speed2 * alpha;
        this.vy = this.vy * (1 - alpha) + tDirY * speed2 * alpha;
      }

      // 3. Surface penetration prevention
      if (dist < SURFACE_MIN) {
        const push = SURFACE_MIN - dist;
        this.x += nx * push;
        this.y += ny * push;

        // Remove velocity component going INTO surface
        const vDotN = this.vx * nx + this.vy * ny;
        if (vDotN < 0) {
          this.vx -= vDotN * nx;
          this.vy -= vDotN * ny;
        }
      }
    }

    // ── Obstacle interaction (simple reflection) ─────────
    for (const obs of obstacles) {
      if (obs.type === 'wall') {
        const ox = obs.x, oy = obs.y, ow = obs.w, oh = obs.h;
        if (this.x >= ox && this.x <= ox + ow &&
            this.y >= oy && this.y <= oy + oh) {
          const dLeft   = this.x - ox;
          const dRight  = ox + ow - this.x;
          const dTop    = this.y - oy;
          const dBottom = oy + oh - this.y;
          if (obs.flowMode === 'streamline') {
            const exitTop = dTop <= dBottom;
            if (exitTop) {
              this.y = oy - 1;
              this.vy = -Math.max(18, Math.abs(this.vy) * 0.35);
            } else {
              this.y = oy + oh + 1;
              this.vy = Math.max(18, Math.abs(this.vy) * 0.35);
            }
            this.vx = Math.max(obs.forwardSpeed || 150, this.vx * 0.92, 0);
          } else {
            const minD = Math.min(dLeft, dRight, dTop, dBottom);
            if      (minD === dLeft)   { this.x = ox - 1;      this.vx = -Math.abs(this.vx) * 0.6; }
            else if (minD === dRight)  { this.x = ox + ow + 1; this.vx =  Math.abs(this.vx) * 0.6; }
            else if (minD === dTop)    { this.y = oy - 1;      this.vy = -Math.abs(this.vy) * 0.6; }
            else                       { this.y = oy + oh + 1; this.vy =  Math.abs(this.vy) * 0.6; }
          }
        }
      }
    }

    // ── Gravity (0 in wind-tunnel mode) ─────────────────────
    const gravForce = (gravity !== undefined) ? gravity : GRAVITY;
    this.vy += gravForce * dt;

    // ── Speed cap ────────────────────────────────────────
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > MAX_SPEED) {
      this.vx = (this.vx / speed) * MAX_SPEED;
      this.vy = (this.vy / speed) * MAX_SPEED;
    }

    // ── Move ─────────────────────────────────────────────
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // ── Tunnel floor — particles that hit the floor respawn at the left edge ──
    const tb = tunnelBounds;
    if (this.y > tb.y + tb.h - 4) {
      // Recirculate: teleport back to spawn band instead of bouncing
      this._needsRespawn = true;
    }
  }

  /** True if this particle has left the visible tunnel area */
  isOutOfBounds(tunnelMaxX, tunnelBounds) {
    return this.x > tunnelMaxX + 20 ||
           this.x < tunnelBounds.x  - 20 ||
           this.y < tunnelBounds.y  - 50 ||
           this.y > tunnelBounds.y + tunnelBounds.h + 50;
  }

  /** True if particle centre is inside a target zone */
  isInTarget(target) {
    return this.x >= target.x && this.x <= target.x + target.w &&
           this.y >= target.y && this.y <= target.y + target.h;
  }

  /** Current speed magnitude */
  speed() {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  }
}

// ── PARTICLE SYSTEM ────────────────────────────────────────────

class ParticleSystem {
  /**
   * @param {object} cfg
   * @param {number}  cfg.count        – max active particles
   * @param {number}  cfg.spawnX       – x position of spawn edge (left)
   * @param {number}  cfg.spawnBandY   – top of the spawn band
   * @param {number}  cfg.spawnBandH   – height of the spawn band
   * @param {number}  cfg.windSpeed    – base particle x-velocity (virtual units/s)
   * @param {object}  cfg.tunnelBounds – { x, y, w, h } virtual tunnel area
   */
  constructor(cfg) {
    this.maxCount     = cfg.count;
    this.spawnX       = cfg.spawnX;
    this.spawnBandY   = cfg.spawnBandY;
    this.spawnBandH   = cfg.spawnBandH;
    this.windSpeed    = cfg.windSpeed;
    this.tunnelBounds = cfg.tunnelBounds;

    this.profiles     = [];
    this.obstacles    = [];

    // Wind-tunnel settings
    this.gravity     = (cfg.gravity    !== undefined) ? cfg.gravity    : GRAVITY;
    this.wallBounce  = (cfg.wallBounce !== undefined) ? cfg.wallBounce : false;
    this.trailLength = cfg.trailLength || 5;

    // Create pool
    this.pool     = [];
    this.particles = [];  // only active particles reference

    for (let i = 0; i < this.maxCount; i++) {
      const p = new Particle();
      p.setTrailLength(this.trailLength);
      this.pool.push(p);
    }

    // Spawn half immediately for instant activity
    this._initialSpawn();

    // Spawn timer
    this._spawnAccum  = 0;
    this._spawnRate   = this.maxCount / 4; // particles per second

    // Scoring history: rolling window
    this._scoreWindowSize = 90; // frames (~1.5s at 60fps)
    this._scoreHistory    = [];
    this._smoothScore     = 0;
  }

  setProfiles(profiles)   { this.profiles  = profiles; }
  setObstacles(obstacles) { this.obstacles = obstacles; }

  /** Update all active particles. dt = seconds since last frame. */
  update(dt) {
    const tb = this.tunnelBounds;

    // Recycle out-of-bounds particles → back to pool
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p.isOutOfBounds(tb.x + tb.w, tb)) {
        p.active = false;
        this.pool.push(p);
        this.particles.splice(i, 1);
      }
    }

    // Update active particles
    for (const p of this.particles) {
      p.update(dt, this.profiles, this.obstacles, tb, this.gravity);

      // Wind-tunnel wall confinement: bounce off ceiling and floor
      if (this.wallBounce) {
        if (p.y <= tb.y + 2) {
          p.y = tb.y + 2;
          if (p.vy < 0) p.vy *= -0.5;
        } else if (p.y >= tb.y + tb.h - 4) {  // same threshold as Particle floor-respawn
          p.y = tb.y + tb.h - 4;
          if (p.vy > 0) p.vy *= -0.5;
          p._needsRespawn = false;  // cancel any respawn set by Particle.update
        }
      }

      // Floor-hit respawn: re-enter from the left instead of bouncing
      if (p._needsRespawn) {
        p._needsRespawn = false;
        p.spawn(this.spawnX, this.spawnBandY, this.spawnBandH, this.windSpeed);
      }
    }

    // Spawn new particles from pool
    this._spawnAccum += dt;
    const toSpawn = Math.floor(this._spawnAccum * this._spawnRate);
    if (toSpawn > 0) {
      this._spawnAccum -= toSpawn / this._spawnRate;
      for (let i = 0; i < toSpawn && this.pool.length > 0; i++) {
        const p = this.pool.pop();
        p.spawn(this.spawnX, this.spawnBandY, this.spawnBandH, this.windSpeed);
        this.particles.push(p);
      }
    }
  }

  /**
   * Compute the fraction of active particles currently inside ANY of the targets.
   * Returns a value 0-1 (smoothed over a rolling window).
   */
  getScore(targets) {
    if (!targets || targets.length === 0) return 0;
    if (this.particles.length === 0) return 0;

    // Scoring line: leftmost target x — only particles past this count
    let scoringX = Infinity;
    for (const t of targets) {
      if (t.x < scoringX) scoringX = t.x;
    }

    let inTarget = 0;
    let downstream = 0;
    for (const p of this.particles) {
      if (p.x < scoringX) continue;
      downstream++;
      for (const t of targets) {
        // Check y-range only (particle already past scoring line)
        if (p.y >= t.y && p.y <= t.y + t.h) { inTarget++; break; }
      }
    }

    const instant = downstream >= 5 ? inTarget / downstream : 0;

    // Rolling average
    this._scoreHistory.push(instant);
    if (this._scoreHistory.length > this._scoreWindowSize) {
      this._scoreHistory.shift();
    }
    this._smoothScore = this._scoreHistory.reduce((a, b) => a + b, 0)
                      / this._scoreHistory.length;

    return this._smoothScore;
  }

  /** Teleport active count and score data */
  stats() {
    return {
      active: this.particles.length,
      total:  this.maxCount,
    };
  }

  reset() {
    // Return all to pool
    for (const p of this.particles) {
      p.active = false;
      this.pool.push(p);
    }
    this.particles = [];
    this._scoreHistory = [];
    this._smoothScore  = 0;
    this._spawnAccum   = 0;
    this._initialSpawn();
  }

  /** Reconfigure for new level */
  reconfigure(cfg) {
    this.spawnX     = cfg.spawnX;
    this.spawnBandY = cfg.spawnBandY;
    this.spawnBandH = cfg.spawnBandH;
    this.windSpeed  = cfg.windSpeed;
    if (cfg.gravity    !== undefined) this.gravity    = cfg.gravity;
    if (cfg.wallBounce !== undefined) this.wallBounce = cfg.wallBounce;
    if (cfg.trailLength !== undefined) {
      this.trailLength = cfg.trailLength;
      for (const p of this.pool) p.setTrailLength(this.trailLength);
      for (const p of this.particles) p.setTrailLength(this.trailLength);
    }
    this.reset();
  }

  // ── PRIVATE ──────────────────────────────────────────────

  _initialSpawn() {
    // Pre-populate so tunnel looks active from frame 0
    const count = Math.floor(this.maxCount * 0.55);
    for (let i = 0; i < count && this.pool.length > 0; i++) {
      const p = this.pool.pop();
      p.spawn(this.spawnX, this.spawnBandY, this.spawnBandH, this.windSpeed);
      // Spread them out horizontally so screen isn't empty on the right
      p.x += (i / count) * (this.tunnelBounds.w * 0.7);
      this.particles.push(p);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// F1 AERODYNAMICS MODEL  (Phase 3)
// ═══════════════════════════════════════════════════════════

function _computeWingElement(angleDeg, groundClearance, spec) {
  const alphaDeg = angleDeg + spec.camberDeg;
  const alphaRad = alphaDeg * Math.PI / 180;
  const gapRatio = clamp((groundClearance + spec.mountOffset) / spec.chord, 0.08, 2.0);
  const groundLiftBoost = 1 + spec.groundLiftBoost * Math.exp(-2.15 * gapRatio);
  const inducedFactor = 1 - spec.groundInducedCut * Math.exp(-1.9 * gapRatio);
  const a0 = 2 * Math.PI;
  const liftSlope = a0 / (1 + a0 / (Math.PI * spec.efficiency * spec.aspectRatio));

  const stallRatio = Math.abs(alphaDeg) / spec.stallAngleDeg;
  const stallLift = stallRatio <= 1
    ? 1
    : Math.max(0.42, 1 - Math.pow(stallRatio - 1, 1.2) * 0.82);
  const separationDrag = stallRatio <= 1
    ? 1
    : 1 + Math.pow(stallRatio - 1, 2) * spec.stallDragGain;

  const cl = spec.areaFactor * liftSlope * alphaRad * groundLiftBoost * stallLift;
  const cdProfile = spec.areaFactor * (
    spec.baseCd +
    spec.alphaDrag * alphaRad * alphaRad * separationDrag +
    spec.extraCamberDrag
  );
  const cdInduced = (cl * cl) / (Math.PI * spec.aspectRatio * spec.efficiency) * inducedFactor;

  return { cl, cd: cdProfile + cdInduced };
}

/**
 * Wing-based aero model for the F1 configurator.
 * Uses thin-airfoil-style lift slope, induced drag, stall falloff, and ride-height scaling.
 * Returns downforce-positive coefficients { Cd, Cl }.
 */
function computeF1Aero(frontAngle, rearAngle, diffAngle, groundClearance) {
  const rideHeight = clamp(groundClearance, 10, 70);

  const frontWing = _computeWingElement(frontAngle, rideHeight, {
    areaFactor: 0.54,
    aspectRatio: 5.4,
    efficiency: 0.86,
    camberDeg: 3.2,
    chord: 86,
    mountOffset: 10,
    groundLiftBoost: 0.62,
    groundInducedCut: 0.26,
    stallAngleDeg: 15.0,
    baseCd: 0.060,
    alphaDrag: 0.28,
    extraCamberDrag: 0.010,
    stallDragGain: 2.8,
  });

  const rearWing = _computeWingElement(rearAngle, rideHeight, {
    areaFactor: 0.78,
    aspectRatio: 4.4,
    efficiency: 0.82,
    camberDeg: 4.8,
    chord: 104,
    mountOffset: 84,
    groundLiftBoost: 0.18,
    groundInducedCut: 0.12,
    stallAngleDeg: 17.0,
    baseCd: 0.078,
    alphaDrag: 0.32,
    extraCamberDrag: 0.014,
    stallDragGain: 2.2,
  });

  const diffAlpha = clamp(diffAngle, 0, 30) * Math.PI / 180;
  const clearancePeak = Math.exp(-Math.pow((rideHeight - 24) / 14, 2));
  const throatSeal = 0.58 + 0.42 * Math.exp(-rideHeight / 42);
  const diffStall = diffAngle <= 12
    ? 1
    : Math.max(0.28, 1 - Math.pow((diffAngle - 12) / 12, 1.35));
  const diffuserCl = 0.22
    + 0.96 * Math.sin(Math.min(diffAlpha, 0.34) * 2.25) * clearancePeak * throatSeal * diffStall;
  const diffuserCd = 0.070
    + 0.11 * diffuserCl * diffuserCl
    + Math.max(0, diffAngle - 12) * 0.010;

  const floorSeal = Math.exp(-Math.pow((rideHeight - 26) / 18, 2));
  const floorCl = 0.32 * floorSeal;
  const bodyCd = 0.56 + 0.0016 * rideHeight;

  const totalCl = frontWing.cl + rearWing.cl + diffuserCl + floorCl;
  const totalCd = bodyCd + frontWing.cd + rearWing.cd + diffuserCd;

  return {
    Cd: clamp(+totalCd.toFixed(3), 0.35, 2.50),
    Cl: clamp(+totalCl.toFixed(3), 0.00, 5.00),
  };
}
