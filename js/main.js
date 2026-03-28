/**
 * main.js — Game Orchestrator
 *
 * State machine: TITLE → PHASE_SELECT → LEVEL_SELECT → PLAYING → COMPLETE
 * Manages the game loop, input routing, level loading, scoring, and transitions.
 *
 * Depends on (loaded before this):
 *   profiles.js  → Profile, PROFILE_SHAPES
 *   physics.js   → ParticleSystem, computeF1Aero
 *   renderer.js  → Renderer
 *   input.js     → InputManager
 *   levels.js    → LEVELS, PHASES, TUNNEL, getLevelIndex, getNextLevelIndex
 *   hud.js       → HUD
 */

'use strict';

// ── VIRTUAL DIMENSIONS ─────────────────────────────────────────
const V_W = 1600;
const V_H = 900;

// Particle count: adapt to device capability
function targetParticleCount() {
  const cores  = navigator.hardwareConcurrency || 2;
  const mobile = window.innerWidth < 900 || ('ontouchstart' in window);
  if (mobile || cores <= 2) return 220;
  if (cores <= 4)           return 320;
  return 400;
}

// ── GAME CLASS ─────────────────────────────────────────────────

class Game {
  constructor() {
    this.canvas    = document.getElementById('game-canvas');
    this.renderer  = new Renderer(this.canvas);
    this.input     = new InputManager(this.canvas, V_W, V_H);
    this.hud       = new HUD();

    // State
    this.state         = 'TITLE';      // TITLE|PHASE_SELECT|LEVEL_SELECT|PLAYING|COMPLETE
    this.currentLevelIdx = 0;
    this.currentPhaseIdx = 0;         // 0-based

    // Level data
    this.profiles    = [];             // Profile instances for current level
    this.obstacles   = [];             // raw obstacle defs {type,x,y,w,h}
    this.targets     = [];             // raw target defs + live _hitRate
    this.particles   = null;           // ParticleSystem

    // Phase 3 F1 state
    this.f1Config    = null;           // { frontWingAngle, rearWingAngle, diffAngle, groundClearance }
    this.f1Handles   = [];             // [{ x, y, label, param, ... }]
    this.f1Targets   = null;
    this.f1SelHandle = -1;
    this.f1FlowProfiles = null;
    this.f1FlowObstacles = null;

    // Dragging
    this.dragProfileIdx   = -1;         // which profile is being dragged
    this.dragF1HandleIdx  = -1;         // which F1 handle is being dragged
    this._hoverProfileIdx = -1;         // profile under pointer (visual highlight)

    // Scoring
    this.score       = 0;
    this.bestScore   = 0;
    this.submitReady = false;

    // Time
    this._lastTime   = 0;
    this._time       = 0;             // cumulative seconds

    // Glitch flash state
    this._flashAlpha = 0;

    this._setupResize();
    this._setupInput();
    this._setupHUD();
    this._setupDebugPanel();

    requestAnimationFrame(t => this._loop(t));
  }

  // ── MAIN LOOP ─────────────────────────────────────────────────

  _loop(timestamp) {
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.05);
    this._lastTime = timestamp;
    this._time    += dt;

    this._update(dt);
    this._render(timestamp / 1000);

    requestAnimationFrame(t => this._loop(t));
  }

  _update(dt) {
    if (this.state !== 'PLAYING') return;

    const level = LEVELS[this.currentLevelIdx];

    if (level.phase === 3) {
      // F1 configurator — no particle physics, just aero formula
      this._updateF1(dt);
    } else {
      // Phases 1 & 2 — particle simulation
      this._animateTargets(dt);
      this.particles.update(dt);

      // Mark hit rate on each target for renderer (downstream scoring)
      let scoringX = Infinity;
      for (const tgt of this.targets) {
        if (tgt.x < scoringX) scoringX = tgt.x;
      }
      let downstream = 0;
      for (const p of this.particles.particles) {
        if (p.x >= scoringX) downstream++;
      }
      for (const tgt of this.targets) {
        let count = 0;
        for (const p of this.particles.particles) {
          if (p.x >= scoringX && p.y >= tgt.y && p.y <= tgt.y + tgt.h) count++;
        }
        tgt._hitRate = downstream >= 5 ? count / downstream : 0;
      }

      this.score = this.particles.getScore(this.targets);
      this.bestScore = Math.max(this.bestScore, this.score);
      this.hud.updateScore(this.score);

      // Telemetry
      const stats = this.particles.stats();
      this.hud.updateTelemetry({
        windSpeed:     level.wind.speed,
        particleCount: stats.active,
        showAero:      false,
      });
    }
  }

  _animateTargets(dt) {
    const t = this._time;
    for (const tgt of this.targets) {
      if (tgt.oscillate) {
        const baseY = tgt._baseY;
        tgt.y = baseY + tgt.oscAmplitude * 0.5 * Math.sin((t / tgt.oscPeriod) * 2 * Math.PI);
      }
    }
  }

  _updateF1(dt) {
    const { frontWingAngle, rearWingAngle, diffAngle, groundClearance } = this.f1Config;
    const { Cd, Cl } = computeF1Aero(frontWingAngle, rearWingAngle, diffAngle, groundClearance);

    this.f1Config.Cd = Cd;
    this.f1Config.Cl = Cl;

    // Score: how well constraints are met
    this.score = this._f1Score(Cd, Cl);
    this.bestScore = Math.max(this.bestScore, this.score);
    this.hud.updateScore(this.score);
    this.hud.updateF1Readout(Cd, Cl, this.f1Targets);
    this.hud.updateTelemetry({
      windSpeed: 350, particleCount: this.particles ? this.particles.particles.length : 0,
      Cd, Cl, showAero: true,
    });

    // Keep particle system running as visual decoration for Phase 3
    if (this.particles) this.particles.update(dt);
  }

  _f1Score(Cd, Cl) {
    const { Cd: cdT, Cl: clT } = this.f1Targets;
    // k=4: violations <25% of target value give decreasing score; >25% give 0.
    // Using product of terms forces BOTH Cd and Cl constraints to be met.
    const k = 4;
    const term = (val, min, max) => {
      let violation = 0;
      if (max !== null && max !== undefined && val > max) violation += (val - max) / max;
      if (min !== null && min !== undefined && val < min) violation += (min - val) / min;
      return Math.max(0, 1 - violation * k);
    };
    return term(Cd, cdT.min, cdT.max) * term(Cl, clT.min, clT.max);
  }

  // ── RENDER ────────────────────────────────────────────────────

  _render(time) {
    if (this.state !== 'PLAYING' && this.state !== 'COMPLETE') {
      // Background only when on menu screens
      const ctx = this.canvas.getContext('2d');
      ctx.fillStyle = '#0e0e14';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    const level = LEVELS[this.currentLevelIdx];

    this.renderer.drawFrame({
      time,
      particles:          this.particles ? this.particles.particles : [],
      profiles:           this.profiles,
      targets:            this.targets,
      obstacles:          this.obstacles,
      selectedProfileIdx: this.dragProfileIdx,
      hoverProfileIdx:    this._hoverProfileIdx,
      f1Config:           level.phase === 3 ? this.f1Config : null,
      f1FlowProfiles:     level.phase === 3 ? this.f1FlowProfiles : null,
      f1FlowObstacles:    level.phase === 3 ? this.f1FlowObstacles : null,
      f1Handles:          this.f1Handles,
      f1SelectedHandle:   this.f1SelHandle,
      phase:              level.phase,
    });

    // Glitch flash on transition
    if (this._flashAlpha > 0) {
      this.renderer.drawFlash(this._flashAlpha);
      this._flashAlpha = Math.max(0, this._flashAlpha - 0.06);
    }
  }

  // ── LEVEL LOADING ─────────────────────────────────────────────

  loadLevel(idx) {
    this.currentLevelIdx = idx;
    const level          = LEVELS[idx];
    this.score           = 0;
    this.bestScore       = 0;
    this._flashAlpha     = 0.5;  // glitch-in flash
    this.f1SelHandle     = -1;
    this.dragProfileIdx  = -1;
    this.dragF1HandleIdx = -1;

    // Obstacles
    this.obstacles = (level.obstacles || []).slice();

    // Targets — initialise animated targets
    this.targets = (level.targets || []).map(t => {
      const copy = { ...t, _hitRate: 0 };
      if (t.oscillate) copy._baseY = t.y;
      return copy;
    });

    if (level.phase === 3) {
      // F1 configurator
      this.f1Config  = { ...level.f1Init };
      this.f1Targets = level.f1Targets;
      this.profiles  = [];

      // Build drag handles (virtual coords)
      this._buildF1Handles();

      // Particle system as visual backdrop (thin stream across tunnel)
      this._resetParticles(level, true);   // wind tunnel mode
      this._applyF1WindTunnel();            // car body + wing physics objects

      this.hud.setF1Target(level.f1Targets, level.description2);
      this.hud.updateTelemetry({ windSpeed: 350, particleCount: 0,
        Cd: 0, Cl: 0, showAero: true });

    } else {
      // Phases 1 & 2 — profile puzzle
      this.f1Config = null;
      this.f1FlowProfiles = null;
      this.f1FlowObstacles = null;
      this.hud.hideF1Target();

      this.profiles = (level.profiles || []).map(p => {
        const prof = new Profile(p);
        return prof;
      });

      this._resetParticles(level, false);
    }

    this.hud.updatePhaseLabel(level.phase, level.levelNum, level.name);
    this.hud.setThresholds(level.thresholds);
    this.hud.updateScore(0);
    this.state = 'PLAYING';
    this.hud.showScreen('playing');
  }

  _resetParticles(level, windTunnel) {
    // windTunnel mode: full-span laminar flow, no gravity, wall confinement, more particles
    const count     = windTunnel
      ? Math.max(320, Math.round(targetParticleCount() * 1.1))
      : targetParticleCount();
    const bandY     = windTunnel ? TUNNEL.y          : (level.spawnBandY || 420);
    const bandH     = windTunnel ? (F1_LAYOUT.referenceY - TUNNEL.y) : (level.spawnBandH || 150);
    const windSpeed = windTunnel ? 350               : (level.wind ? level.wind.speed : 220);
    const gravity   = windTunnel ? 0                 : GRAVITY;
    const wallBounce = windTunnel;
    const trailLength = windTunnel ? 24 : 5;

    // Force full recreation when the pool size needs to change (e.g. entering wind-tunnel mode)
    if (this.particles && this.particles.maxCount !== count) {
      this.particles = null;
    }

    if (this.particles) {
      this.particles.reconfigure({
        spawnX: TUNNEL.x,
        spawnBandY: bandY,
        spawnBandH: bandH,
        windSpeed,
        gravity,
        wallBounce,
        trailLength,
      });
    } else {
      this.particles = new ParticleSystem({
        count:        count,
        spawnX:       TUNNEL.x,
        spawnBandY:   bandY,
        spawnBandH:   bandH,
        windSpeed:    windSpeed,
        gravity:      gravity,
        wallBounce:   wallBounce,
        trailLength:  trailLength,
        tunnelBounds: TUNNEL,
      });
    }

    this.particles.setProfiles(this.profiles);
    this.particles.setObstacles(this.obstacles);
  }

  // ── F1 WIND TUNNEL ────────────────────────────────────────────

  /**
   * Build physics-only obstacles (car body) and non-draggable wing profiles
   * that represent the current F1 configuration inside the particle simulation.
   * Neither is rendered directly — the car is drawn by _drawF1Car().
   */
  _buildF1WindTunnelSetup() {
    const cfg     = this.f1Config;
    const gc      = cfg.groundClearance;
    const baseX   = F1_LAYOUT.baseX;
    const refY    = F1_LAYOUT.referenceY;

    // ── Car body obstacle (simplified bounding box) ──────────
    const bodyTopY = refY - gc - 92;
    const carObs   = {
      type: 'wall', flowMode: 'streamline', forwardSpeed: 185,
      x: baseX + 48, y: bodyTopY, w: 680, h: 74,
    };

    // ── Rear strut (thin column) ─────────────────────────────
    const strutObs = {
      type: 'wall',
      flowMode: 'streamline', forwardSpeed: 170,
      x: baseX + 694, y: bodyTopY - 70, w: 16, h: 70,
    };

    // ── Ground/Track layer ───────────────────────────────────
    const groundObs = {
      type: 'wall',
      flowMode: 'streamline', forwardSpeed: 350,
      x: -100, y: refY, w: 2000, h: 400,
    };

    // ── Wing profiles (Coanda physics, not rendered as neon outlines) ──
    const fwProfile  = new Profile({
      type:      'wing',
      x:         baseX + 72,
      y:         refY - gc - 26,
      angle:     -cfg.frontWingAngle,
      draggable: false,
      minX: 0, maxX: 1600, minY: 0, maxY: 900,
    });

    const rwProfile = new Profile({
      type:      'wing',
      x:         baseX + 700,
      y:         bodyTopY - 26,
      angle:     -cfg.rearWingAngle,
      draggable: false,
      minX: 0, maxX: 1600, minY: 0, maxY: 900,
    });

    const diffuserProfile = new Profile({
      type:      'flat',
      x:         baseX + 706,
      y:         refY - gc - 8,
      angle:     -cfg.diffAngle,
      draggable: false,
      minX: 0, maxX: 1600, minY: 0, maxY: 900,
    });

    return {
      obstacles: [carObs, strutObs, groundObs],
      profiles:  [fwProfile, rwProfile, diffuserProfile],
    };
  }

  /** Apply wind-tunnel obstacles/profiles to the particle system. */
  _applyF1WindTunnel() {
    const setup = this._buildF1WindTunnelSetup();
    this.f1FlowProfiles = setup.profiles;
    this.f1FlowObstacles = setup.obstacles;
    if (!this.particles) return;
    this.particles.setObstacles(setup.obstacles);
    this.particles.setProfiles(setup.profiles);
  }



  _buildF1Handles() {
    const cfg  = this.f1Config;
    const gc   = cfg.groundClearance;
    const baseX = F1_LAYOUT.baseX;
    const refY = F1_LAYOUT.referenceY;

    this.f1Handles = [
      {
        label:  'FW ANGLE',
        param:  'frontWingAngle',
        x:      baseX + 74,
        y:      refY - gc - 24,
        sense:  'y',   // drag axis: up=decrease angle, down=increase
        scale:  0.4,   // degrees per virtual unit
        min:    0, max: 45,
      },
      {
        label:  'RW ANGLE',
        param:  'rearWingAngle',
        x:      baseX + 700,
        y:      refY - gc - 118,
        sense:  'y',
        scale:  0.3,
        min:    0, max: 45,
      },
      {
        label:  'DIFFUSER',
        param:  'diffAngle',
        x:      baseX + 762,
        y:      refY - gc - 6,
        sense:  'y',
        scale:  0.25,
        min:    0, max: 30,
      },
      {
        label:  'RIDE HT',
        param:  'groundClearance',
        x:      baseX + 392,
        y:      refY - gc,
        sense:  'y',
        scale: -0.5,                     // drag down = lower clearance
        min:    10, max: 70,
      },
    ];
  }

  // ── SCORING & COMPLETION ──────────────────────────────────────

  _calcStars(score, thresholds) {
    if (score >= thresholds[2]) return 3;
    if (score >= thresholds[1]) return 2;
    if (score >= thresholds[0]) return 1;
    return 0;
  }

  _submit() {
    const level  = LEVELS[this.currentLevelIdx];
    const stars  = this._calcStars(this.bestScore, level.thresholds);
    const pct    = (this.bestScore * 100).toFixed(1);
    const detail = level.phase === 3
      ? `Cd ${this.f1Config.Cd.toFixed(2)}  //  Cl ${this.f1Config.Cl.toFixed(2)}`
      : `FLOW CAPTURE: ${pct}%  //  ${stars >= 1 ? 'LOCKED IN' : 'INSUFFICIENT'}`;

    const hasNext = getNextLevelIndex(this.currentLevelIdx) !== null;

    this.state = 'COMPLETE';
    this._flashAlpha = 0.6;

    this.hud.showComplete(stars, detail, hasNext, level.id);

    // Unlock next phase if phase all done
    this._checkPhaseUnlock(level.phase);
  }

  _checkPhaseUnlock(completedPhase) {
    const pi    = completedPhase - 1;
    const phase = PHASES[pi];
    // If all levels in this phase have at least 1 star, unlock next phase
    const allDone = phase.levels.every(li => (this.hud._stars[LEVELS[li].id] || 0) >= 1);
    if (allDone && completedPhase < PHASES.length) {
      this.hud.updatePhaseUnlocks(completedPhase); // unlock next (0-based idx = completedPhase)
    }
  }

  // ── INPUT SETUP ───────────────────────────────────────────────

  _setupInput() {
    const inp = this.input;

    inp.onDragStart(drag => {
      if (this.state !== 'PLAYING') return;
      const level = LEVELS[this.currentLevelIdx];

      if (level.phase === 3) {
        this._startF1Drag(drag);
      } else {
        this._startProfileDrag(drag);
      }
    });

    inp.onDragMove(drag => {
      if (this.state !== 'PLAYING') return;
      const level = LEVELS[this.currentLevelIdx];

      if (level.phase === 3) {
        this._moveF1Drag(drag);
      } else {
        this._moveProfileDrag(drag);
      }
    });

    inp.onDragEnd(() => {
      this.dragProfileIdx   = -1;
      this.dragF1HandleIdx  = -1;
      this.f1SelHandle      = -1;
      this._hoverProfileIdx = -1;
    });

    inp.onRotate(delta => {
      if (this.state !== 'PLAYING') return;
      const level = LEVELS[this.currentLevelIdx];
      if (level.phase === 3) return;
      if (this.dragProfileIdx >= 0) {
        this.profiles[this.dragProfileIdx].rotateDeg(delta);
        this.particles.setProfiles(this.profiles);
      }
    });
  }

  _startProfileDrag(drag) {
    const { currentVX: vx, currentVY: vy } = drag;

    // Hit-test profiles in reverse (top-most rendered last = highest index)
    for (let i = this.profiles.length - 1; i >= 0; i--) {
      if (this.profiles[i].hitTest(vx, vy, 45)) {
        this.dragProfileIdx    = i;
        this._hoverProfileIdx  = i;
        return;
      }
    }
    this.dragProfileIdx   = -1;
    this._hoverProfileIdx = -1;
  }

  _moveProfileDrag(drag) {
    if (this.dragProfileIdx < 0) return;
    const profile = this.profiles[this.dragProfileIdx];

    if (drag.rotateMode) {
      // Rotate based on horizontal delta
      profile.rotateDeg(drag.deltaVX * 0.4);
    } else {
      profile.move(drag.deltaVX, drag.deltaVY);
    }

    this.particles.setProfiles(this.profiles);
  }

  _startF1Drag(drag) {
    const { currentVX: vx, currentVY: vy } = drag;
    const HANDLE_RADIUS = 45;

    for (let i = 0; i < this.f1Handles.length; i++) {
      const h  = this.f1Handles[i];
      const dy = vy - h.y;
      const dx = vx - h.x;
      if (Math.sqrt(dx * dx + dy * dy) < HANDLE_RADIUS) {
        this.dragF1HandleIdx = i;
        this.f1SelHandle     = i;
        return;
      }
    }
    this.dragF1HandleIdx = -1;
    this.f1SelHandle     = -1;
  }

  _moveF1Drag(drag) {
    if (this.dragF1HandleIdx < 0) return;
    const h   = this.f1Handles[this.dragF1HandleIdx];
    const cfg = this.f1Config;

    // Move handle visually
    h.x += drag.deltaVX;
    h.y += drag.deltaVY;

    // Map y-drag (up = negative dy) to parameter change
    let delta = 0;
    if (h.sense === 'y') delta = drag.deltaVY * h.scale;
    else                 delta = drag.deltaVX * h.scale;

    cfg[h.param] = Math.max(h.min, Math.min(h.max, cfg[h.param] + delta));

    // Recompute handle positions to stay attached to car geometry
    if (h.param === 'groundClearance') {
      this._buildF1Handles();
      this.f1SelHandle = this.dragF1HandleIdx; // keep selection
    }

    // Rebuild wind tunnel physics so particles react to new wing angles / ride height
    this._applyF1WindTunnel();
  }

  // ── HUD SETUP ─────────────────────────────────────────────────

  _setupHUD() {
    this.hud.bindEvents({
      onStart:       () => this._onStart(),
      onPhaseSelect: (pi) => this._onPhaseSelect(pi),
      onLevelSelect: (li) => this.loadLevel(li),
      onSubmit:      () => this._submit(),
      onRetry:       () => this.loadLevel(this.currentLevelIdx),
      onNext:        () => {
        const next = getNextLevelIndex(this.currentLevelIdx);
        if (next !== null) this.loadLevel(next);
        else this._goToPhaseSelect();
      },
      onAbort:       () => this._goToPhaseSelect(),
      onToTitle:     () => {
        this.state = 'TITLE';
        this.hud.showScreen('title');
        this.hud.hideF1Target();
      },
      onToPhases:    () => this._goToPhaseSelect(),
      onRotateToggle: (v) => this.input.setRotateMode(v),
    });

    this.hud.showScreen('title');
    this.hud.updatePhaseUnlocks(0); // Only phase 0 unlocked initially
  }

  _onStart() {
    this.state = 'PHASE_SELECT';
    this.hud.showScreen('phase-select');
  }

  _onPhaseSelect(phaseIdx) {
    this.currentPhaseIdx = phaseIdx;
    this.hud.populateLevelSelect(phaseIdx);
    this.hud.showScreen('level-select');
  }

  _goToPhaseSelect() {
    this.state = 'PHASE_SELECT';
    this.hud.hideF1Target();
    this.hud.showScreen('phase-select');
  }

  // ── DEBUG PANEL ───────────────────────────────────────────────

  _setupDebugPanel() {
    const panel   = document.getElementById('debug-panel');
    const toggle  = document.getElementById('dbg-toggle');
    const selIdx  = document.getElementById('dbg-profile-idx');
    const sldX    = document.getElementById('dbg-x');
    const sldY    = document.getElementById('dbg-y');
    const sldAng  = document.getElementById('dbg-angle');
    const valX    = document.getElementById('dbg-x-val');
    const valY    = document.getElementById('dbg-y-val');
    const valAng  = document.getElementById('dbg-ang-val');
    const scoreLn = document.getElementById('dbg-score-line');
    if (!panel || !toggle) return;

    const getProfile = () => {
      if (this.state !== 'PLAYING' || !this.profiles.length) return null;
      return this.profiles[parseInt(selIdx.value) || 0] || null;
    };

    const applyToProfile = () => {
      const p = getProfile();
      if (!p) return;
      p.setPosition(parseFloat(sldX.value), parseFloat(sldY.value));
      p.setAngle(parseFloat(sldAng.value));
      if (this.particles) this.particles.setProfiles(this.profiles);
    };

    sldX.addEventListener('input',   () => { valX.textContent   = sldX.value;   applyToProfile(); });
    sldY.addEventListener('input',   () => { valY.textContent   = sldY.value;   applyToProfile(); });
    sldAng.addEventListener('input', () => { valAng.textContent = sldAng.value; applyToProfile(); });

    // Populate profile selector when level loads (re-check every 500ms)
    setInterval(() => {
      // Sync slider values from canvas drag (bidirectional)
      const p = getProfile();
      if (p && !panel.classList.contains('hidden')) {
        const rx = Math.round(p.x);
        const ry = Math.round(p.y);
        const ra = Math.round(p.angle * 2) / 2;
        if (sldX.value != rx)  { sldX.value  = rx;  valX.textContent  = rx; }
        if (sldY.value != ry)  { sldY.value  = ry;  valY.textContent  = ry; }
        if (sldAng.value != ra){ sldAng.value = ra; valAng.textContent = ra; }
      }
      // Update best score line
      if (scoreLn && this.state === 'PLAYING') {
        const pct  = (this.bestScore * 100).toFixed(1);
        const cur  = (this.score * 100).toFixed(1);
        scoreLn.textContent = `BEST ${pct}% // NOW ${cur}%`;
      }
      // Rebuild profile selector options if count changed
      if (this.state === 'PLAYING') {
        const n = this.profiles.length;
        if (selIdx.options.length !== n) {
          selIdx.innerHTML = '';
          for (let i = 0; i < n; i++) {
            const o = document.createElement('option');
            o.value = i; o.textContent = i;
            selIdx.appendChild(o);
          }
        }
      }
    }, 100);

    // Toggle panel with button or 'D' key
    const doToggle = () => {
      const level = LEVELS[this.currentLevelIdx];
      // Debug panel only meaningful in phases 1 & 2 (has profiles to control)
      if (this.state === 'PLAYING' && level && level.phase === 3) return;
      const hidden = panel.classList.toggle('hidden');
      toggle.classList.toggle('active', !hidden);
      // On open: sync sliders immediately
      if (!hidden) {
        const p = getProfile();
        if (p) {
          sldX.value  = Math.round(p.x);  valX.textContent  = sldX.value;
          sldY.value  = Math.round(p.y);  valY.textContent  = sldY.value;
          sldAng.value = Math.round(p.angle * 2) / 2; valAng.textContent = sldAng.value;
        }
      }
    };
    toggle.addEventListener('click', doToggle);
    document.addEventListener('keydown', e => {
      if (e.key === 'd' || e.key === 'D') doToggle();
    });
  }

  // ── RESIZE ────────────────────────────────────────────────────

  _setupResize() {
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.canvas.width  = w;
      this.canvas.height = h;

      // Calculate scale & centering offset (letterbox/pillarbox)
      const scale   = Math.min(w / V_W, h / V_H);
      const offsetX = (w - V_W * scale) / 2;
      const offsetY = (h - V_H * scale) / 2;

      this.renderer.resize(scale, offsetX, offsetY);
      this.input.updateTransform(scale, offsetX, offsetY);
    };

    resize();
    window.addEventListener('resize', resize);
    // Also observe canvas container size changes
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(resize).observe(document.body);
    }
  }
}

// ── BOOT ───────────────────────────────────────────────────────
// Instantiate once DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
