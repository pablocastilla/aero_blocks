/**
 * hud.js — DOM-based HUD Manager
 *
 * Controls all non-canvas UI: screens (title, phase-select, level-select,
 * complete), the in-game HUD panels, score bar, telemetry, star displays,
 * and event bindings for all buttons.
 *
 * Following DESIGN.md: Bungee for titles, Share Tech Mono for numbers,
 * Space Grotesk for labels. All event bindings go through this module
 * so main.js stays clean.
 */

'use strict';

class HUD {
  constructor() {
    // Cache all DOM references on construction
    this._el = {
      // Screens
      title:       document.getElementById('screen-title'),
      phaseSelect: document.getElementById('screen-phase-select'),
      levelSelect: document.getElementById('screen-level-select'),
      complete:    document.getElementById('screen-complete'),
      portrait:    document.getElementById('portrait-overlay'),
      hud:         document.getElementById('hud'),

      // HUD - playing state
      hudPhase:    document.getElementById('hud-phase'),
      hudMission:  document.getElementById('hud-mission'),
      hudScore:    document.getElementById('hud-score'),
      hudStars:    document.getElementById('hud-stars'),
      scoreBar:    document.getElementById('score-bar-fill'),
      btnSubmit:   document.getElementById('btn-submit'),

      // Telemetry
      telWind:     document.getElementById('tel-wind'),
      telParticles:document.getElementById('tel-particles'),
      telAero:     document.getElementById('tel-aero'),
      telCd:       document.getElementById('tel-cd'),
      telCl:       document.getElementById('tel-cl'),

      // Bottom-right HUD
      btnRotate:   document.getElementById('btn-rotate'),
      btnAbort:    document.getElementById('btn-abort'),

      // Title
      btnStart:    document.getElementById('btn-start'),

      // Phase select
      phaseGrid:   document.getElementById('phase-grid'),
      btnToTitle:  document.getElementById('btn-to-title'),

      // Level select
      levelGrid:   document.getElementById('level-grid'),
      lselTitle:   document.getElementById('lsel-title'),
      lselCorner:  document.getElementById('lsel-corner'),
      btnToPhases: document.getElementById('btn-to-phases'),

      // Level complete
      cTitle:       document.getElementById('complete-title'),
      cStars:       [document.getElementById('cstar-1'), document.getElementById('cstar-2'), document.getElementById('cstar-3')],
      cDetail:      document.getElementById('complete-detail'),
      btnRetry:     document.getElementById('btn-retry'),
      btnPhasesBack:document.getElementById('btn-phases-back'),
      btnNext:      document.getElementById('btn-next'),
    };

    // Callbacks — set via bindEvents()
    this._cb = {};

    // Star save (levelId → stars earned 0-3)
    this._stars = {};

    // Thresholds for current level (for live star display)
    this._thresholds = [0.30, 0.55, 0.80];

    // Rotate mode state
    this._rotateMode = false;

    // Portrait detection
    this._portraitMQ = window.matchMedia('(orientation: portrait)');

    this._bindPortraitDetection();
  }

  // ── SCREEN MANAGEMENT ─────────────────────────────────────────

  /**
   * Show one screen, hide all others.
   * name: 'title' | 'phase-select' | 'level-select' | 'playing' | 'complete'
   */
  showScreen(name) {
    const { title, phaseSelect, levelSelect, complete, hud } = this._el;

    // Hide all
    title.classList.add('hidden');       title.classList.remove('active');
    phaseSelect.classList.add('hidden'); phaseSelect.classList.remove('active');
    levelSelect.classList.add('hidden'); levelSelect.classList.remove('active');
    complete.classList.add('hidden');    complete.classList.remove('active');
    hud.classList.add('hidden');

    // Show target
    switch (name) {
      case 'title':
        title.classList.remove('hidden'); title.classList.add('active');
        break;
      case 'phase-select':
        phaseSelect.classList.remove('hidden'); phaseSelect.classList.add('active');
        this._refreshPhaseStars();
        break;
      case 'level-select':
        levelSelect.classList.remove('hidden'); levelSelect.classList.add('active');
        break;
      case 'playing':
        hud.classList.remove('hidden');
        break;
      case 'complete':
        complete.classList.remove('hidden'); complete.classList.add('active');
        break;
    }
  }

  // ── PLAYING HUD ───────────────────────────────────────────────

  updatePhaseLabel(phase, levelNum, levelName) {
    this._el.hudPhase.textContent   = String(phase).padStart(2, '0');
    this._el.hudMission.textContent =
      `MISSION ${String(phase).padStart(2,'0')}.${String(levelNum).padStart(2,'0')} — ${levelName}`;
  }

  setThresholds(thresholds) {
    this._thresholds = thresholds || [0.30, 0.55, 0.80];
  }

  updateScore(fraction) {
    const pct = Math.round(fraction * 1000) / 10;
    this._el.hudScore.textContent  = pct.toFixed(1) + '%';
    this._el.scoreBar.style.width  = Math.min(100, pct) + '%';

    // Live star display
    const t = this._thresholds;
    const stars = fraction >= t[2] ? 3 : fraction >= t[1] ? 2 : fraction >= t[0] ? 1 : 0;
    const el = this._el.hudStars;
    if (el) {
      el.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      el.className = 'hud-stars-live' + (stars > 0 ? ` stars-${stars}` : '');
    }

    // Enable SUBMIT when score is meaningful
    const threshold = 0.28;
    const btn = this._el.btnSubmit;
    if (fraction >= threshold) {
      btn.disabled = false;
      if (!btn.classList.contains('pulse-ready')) {
        btn.classList.add('pulse-ready');
      }
    } else {
      btn.disabled = true;
      btn.classList.remove('pulse-ready');
    }
  }

  updateTelemetry({ windSpeed, particleCount, Cd, Cl, showAero }) {
    this._el.telWind.textContent      = `${Math.round(windSpeed)} m/s`;
    this._el.telParticles.textContent = String(particleCount);

    if (showAero && Cd !== undefined && Cl !== undefined) {
      this._el.telAero.classList.remove('hidden');
      this._el.telCd.textContent = Cd.toFixed(2);
      this._el.telCl.textContent = Cl.toFixed(2);
    } else {
      this._el.telAero.classList.add('hidden');
    }
  }

  setSubmitEnabled(v) {
    this._el.btnSubmit.disabled = !v;
    if (v) {
      this._el.btnSubmit.classList.add('pulse-ready');
    } else {
      this._el.btnSubmit.classList.remove('pulse-ready');
    }
  }

  // ── PHASE SELECT ──────────────────────────────────────────────

  /**
   * Unlock/lock phase cards and update star displays.
   * @param {number} unlockedUpTo  – 0-based index of highest unlocked phase
   */
  updatePhaseUnlocks(unlockedUpTo) {
    const cards = this._el.phaseGrid.querySelectorAll('.phase-card');
    cards.forEach((card, i) => {
      const locked = i > unlockedUpTo;
      card.classList.toggle('locked', locked);
      const badge = card.querySelector('.phase-badge');
      if (badge) {
        badge.textContent = locked ? 'LOCKED' : 'AVAILABLE';
        badge.className   = 'phase-badge ' + (locked ? 'locked' : 'available');
      }
    });
  }

  _refreshPhaseStars() {
    PHASES.forEach((phase, pi) => {
      const el = document.getElementById(`ps-stars-${pi}`);
      if (!el) return;
      // Best stars across all levels in this phase
      const totalStars = phase.levels.reduce((sum, li) => {
        const s = this._stars[LEVELS[li].id] || 0;
        return sum + s;
      }, 0);
      el.textContent = this._starsStr(totalStars, phase.levels.length * 3);
    });
  }

  _starsStr(earned, max) {
    const filled = Math.round((earned / max) * 3);
    return '★'.repeat(filled) + '☆'.repeat(3 - filled);
  }

  // ── LEVEL SELECT ──────────────────────────────────────────────

  populateLevelSelect(phaseIndex) {
    const phase    = PHASES[phaseIndex];
    const grid     = this._el.levelGrid;
    grid.innerHTML = '';

    this._el.lselTitle.textContent  = `PHASE ${String(phaseIndex + 1).padStart(2, '0')} MISSIONS`;
    this._el.lselCorner.textContent = `PHASE ${phaseIndex + 1}: ${phase.title}`;

    for (let i = 0; i < phase.levels.length; i++) {
      const li    = phase.levels[i];
      const level = LEVELS[li];
      const stars = this._stars[level.id] || 0;

      const card = document.createElement('div');
      card.className = 'level-card';
      card.dataset.levelIndex = li;
      card.innerHTML = `
        <div class="level-num font-mono">MISSION ${String(level.levelNum).padStart(2,'0')}</div>
        <div class="level-name font-display">${level.name}</div>
        <div class="level-desc font-body">${level.description}</div>
        <div class="level-stars">${'★'.repeat(stars)}${'☆'.repeat(3-stars)}</div>
      `;
      card.addEventListener('pointerup', () => {
        if (this._cb.onLevelSelect) this._cb.onLevelSelect(li);
      });
      grid.appendChild(card);
    }
  }

  // ── LEVEL COMPLETE ────────────────────────────────────────────

  /**
   * @param {number} stars   0-3
   * @param {string} detail  score text e.g. "FLOW CAPTURE: 78.3%"
   * @param {boolean} hasNext
   * @param {string}  levelId
   */
  showComplete(stars, detail, hasNext, levelId) {
    // Save best stars
    const prev = this._stars[levelId] || 0;
    if (stars > prev) this._stars[levelId] = stars;

    this._el.cDetail.textContent = detail;
    this._el.btnNext.disabled    = !hasNext;

    // Animate stars in sequence
    this._el.cStars.forEach(s => {
      s.textContent = '☆';
      s.className   = 'star-lg';
    });
    this._el.cTitle.textContent = stars > 0 ? 'MISSION COMPLETE' : 'INSUFFICIENT FLOW';
    this._el.cTitle.style.color = stars > 0 ? 'var(--primary)' : 'var(--secondary-container)';

    setTimeout(() => this._animateStars(stars), 200);

    this.showScreen('complete');
  }

  _animateStars(count) {
    for (let i = 0; i < 3; i++) {
      ((idx) => {
        setTimeout(() => {
          const el = this._el.cStars[idx];
          if (idx < count) {
            el.textContent = '★';
            el.classList.add('lit');
          } else {
            el.textContent = '☆';
          }
        }, idx * 280);
      })(i);
    }
  }

  // ── ROTATE MODE ───────────────────────────────────────────────

  toggleRotateMode() {
    this._rotateMode = !this._rotateMode;
    const btn  = this._el.btnRotate;
    const lbl  = document.getElementById('rotate-label');
    btn.setAttribute('aria-pressed', this._rotateMode ? 'true' : 'false');
    lbl.textContent = this._rotateMode ? '↻ ROTATE' : '↔ MOVE';
    if (this._cb.onRotateToggle) this._cb.onRotateToggle(this._rotateMode);
  }

  // ── PORTRAIT ──────────────────────────────────────────────────

  _bindPortraitDetection() {
    const check = () => {
      const isPortrait = window.innerHeight > window.innerWidth;
      this._el.portrait.classList.toggle('hidden', !isPortrait);
    };
    check();
    this._portraitMQ.addEventListener('change', check);
    window.addEventListener('resize', check);
  }

  // ── EVENT BINDINGS ────────────────────────────────────────────

  /**
   * Bind all button events.
   * callbacks:
   *   onStart, onPhaseSelect(phaseIdx), onLevelSelect(levelIdx),
   *   onSubmit, onRetry, onNext, onAbort, onToTitle, onToPhases, onRotateToggle(v)
   */
  bindEvents(callbacks) {
    this._cb = callbacks;
    const { _el, _cb } = this;

    // Title
    _el.btnStart.addEventListener('pointerup', () => _cb.onStart?.());

    // Phase select
    _el.phaseGrid.querySelectorAll('.phase-card').forEach((card, i) => {
      card.addEventListener('pointerup', () => {
        if (card.classList.contains('locked')) return;
        _cb.onPhaseSelect?.(i);
      });
    });
    _el.btnToTitle.addEventListener('pointerup', () => _cb.onToTitle?.());

    // Level select
    _el.btnToPhases.addEventListener('pointerup', () => _cb.onToPhases?.());

    // HUD
    _el.btnSubmit.addEventListener('pointerup', () => {
      if (!_el.btnSubmit.disabled) _cb.onSubmit?.();
    });
    _el.btnAbort.addEventListener('pointerup',  () => _cb.onAbort?.());
    _el.btnRotate.addEventListener('pointerup', () => this.toggleRotateMode());

    // Level complete
    _el.btnRetry.addEventListener('pointerup',      () => _cb.onRetry?.());
    _el.btnPhasesBack.addEventListener('pointerup', () => _cb.onToPhases?.());
    _el.btnNext.addEventListener('pointerup', () => {
      if (!_el.btnNext.disabled) _cb.onNext?.();
    });
  }

  // ── F1 TARGET OVERLAY ─────────────────────────────────────────

  /**
   * Show/hide and update the F1 aerodynamic target info.
   * Called once when Phase 3 level is loaded.
   */
  setF1Target(f1Targets, descText) {
    // Inject or update a floating banner showing target Cd/Cl ranges + live values
    let el = document.getElementById('f1-targets');
    if (!el) {
      el = document.createElement('div');
      el.id = 'f1-targets';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }

    const fmt = (v, dp = 2) => (v === null || v === undefined) ? '—' : v.toFixed(dp);
    const Cd  = f1Targets.Cd || {};
    const Cl  = f1Targets.Cl || {};

    el.innerHTML = `
      <div class="f1-target-group">
        <span class="label-sm" style="color:var(--outline)">TARGET DRAG</span>
        <span class="f1-target-val">${fmt(Cd.min)} – ${fmt(Cd.max)}</span>
        <span class="label-sm" style="color:var(--outline)">NOW</span>
        <span id="f1t-cd-live" class="f1-target-val" style="color:var(--secondary-container)">—</span>
      </div>
      <div class="tel-sep" style="height:2.5rem;width:1px;background:var(--outline-variant);opacity:0.4"></div>
      <div class="f1-target-group">
        <span class="label-sm" style="color:var(--outline)">TARGET DOWNFORCE</span>
        <span class="f1-target-val">${fmt(Cl.min)} – ${fmt(Cl.max)}</span>
        <span class="label-sm" style="color:var(--outline)">NOW</span>
        <span id="f1t-cl-live" class="f1-target-val" style="color:var(--secondary-container)">—</span>
      </div>
      <div class="label-sm dim" style="margin-top:0.65rem;width:100%;text-align:center;letter-spacing:0.18em">
        LESS DRAG = MORE SPEED // MORE DOWNFORCE = MORE GRIP
      </div>
    `;
    // Cache live elements
    this._f1LiveCd = document.getElementById('f1t-cd-live');
    this._f1LiveCl = document.getElementById('f1t-cl-live');
    this._f1Targets = f1Targets;

    el.classList.remove('hidden');
  }

  hideF1Target() {
    const el = document.getElementById('f1-targets');
    if (el) el.classList.add('hidden');
  }

  /**
   * Update Cd/Cl values with visual in-range highlighting.
   */
  updateF1Readout(Cd, Cl, f1Targets) {
    const cdEl = this._el.telCd;
    const clEl = this._el.telCl;

    cdEl.textContent = Cd.toFixed(2);
    clEl.textContent = Cl.toFixed(2);

    // Color feedback on bottom-left telemetry
    const cdOk = this._inRange(Cd, f1Targets.Cd);
    const clOk = this._inRange(Cl, f1Targets.Cl);
    cdEl.style.color = cdOk ? 'var(--primary-container)' : 'var(--secondary-container)';
    clEl.style.color = clOk ? 'var(--primary-container)' : 'var(--secondary-container)';

    // Also update the top f1-targets panel live readout
    if (this._f1LiveCd) {
      this._f1LiveCd.textContent = Cd.toFixed(2);
      this._f1LiveCd.style.color = cdOk ? 'var(--primary-container)' : 'var(--secondary-container)';
    }
    if (this._f1LiveCl) {
      this._f1LiveCl.textContent = Cl.toFixed(2);
      this._f1LiveCl.style.color = clOk ? 'var(--primary-container)' : 'var(--secondary-container)';
    }
  }

  _inRange(val, range) {
    if (!range) return true;
    if (range.min !== null && range.min !== undefined && val < range.min) return false;
    if (range.max !== null && range.max !== undefined && val > range.max) return false;
    return true;
  }
}
