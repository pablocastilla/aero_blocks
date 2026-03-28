/**
 * renderer.js — Canvas Rendering Engine
 *
 * Draws everything onto the game canvas following DESIGN.md:
 *   - Deep void background with CRT scanlines
 *   - Neon cyan particles with additive blending + trails
 *   - Profile shapes with 4px glow strokes
 *   - Target zones with animated magenta borders
 *   - F1 car with hard angular shapes
 *   - Drag handles for interaction feedback
 *
 * All game elements are defined in virtual 1600×900 space.
 * The renderer maps to actual canvas pixels via scale+offset.
 */

'use strict';

// ── COLOURS ────────────────────────────────────────────────────
const C_BACKGROUND   = '#0e0e14';
const C_TUNNEL_FILL  = '#0e0e14';
const C_PRIMARY      = '#00F0FF';
const C_SECONDARY    = '#FF525C';
const C_TERTIARY     = '#ffb77f';
const C_SURFACE_HIGH = '#2a2930';
const C_OUTLINE_DIM  = '#3b494b';
const C_ON_SURFACE   = '#dbfcff';
const C_PRIMARY_DIM  = 'rgba(0,240,255,0.18)';
const C_SECONDARY_DIM= 'rgba(255,82,92,0.18)';
const C_GRID         = 'rgba(59,73,75,0.07)';
const C_SCANLINE     = 'rgba(0,0,0,0.07)';

class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.scale   = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.vW      = 1600;
    this.vH      = 900;
    this._time   = 0;

    // Build scanline pattern (one-time, re-built on resize)
    this._scanlinePattern = null;
    this._buildScanlinePattern();
  }

  // ── SETUP ─────────────────────────────────────────────────────

  /** Call whenever canvas physical size changes. */
  resize(scale, offsetX, offsetY) {
    this.scale   = scale;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this._buildScanlinePattern();
  }

  _buildScanlinePattern() {
    const pc = document.createElement('canvas');
    pc.width  = 4;
    pc.height = 4;
    const c   = pc.getContext('2d');
    c.fillStyle = C_SCANLINE;
    c.fillRect(0, 2, 4, 2);
    try {
      this._scanlinePattern = this.ctx.createPattern(pc, 'repeat');
    } catch (e) {
      this._scanlinePattern = null;
    }
  }

  // ── MAIN DRAW PIPELINE ─────────────────────────────────────────

  /** Full frame. Call order matters: bg → tunnel → obstacles → targets →
   *  particles → profiles → handles. */
  drawFrame(state) {
    const { time, particles, profiles, targets, obstacles,
            selectedProfileIdx, hoverProfileIdx,
            f1Config, f1FlowProfiles, f1FlowObstacles,
            f1Handles, f1SelectedHandle,
            phase } = state;

    this._time = time;
    const ctx  = this.ctx;

    ctx.save();

    // 1 ── Background
    this._drawBackground();

    // 2 ── Tunnel area (slightly different shade)
    // (The Virtual tunnel bounds should be passed but we draw fullscreen)

    // 3 ── Obstacles
    for (const obs of (obstacles || [])) {
      this._drawObstacle(obs);
    }

    // 4 ── Target zones
    for (const tgt of (targets || [])) {
      this._drawTarget(tgt, time);
    }

    // 5 ── F1 car (Phase 3 only)
    if (phase === 3 && f1Config) {
      this._drawF1Car(f1Config);
    }

    // 6 ── Particles (additive blending ON)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this._drawParticles(particles || [], phase, f1Config, f1FlowProfiles, f1FlowObstacles);
    ctx.restore();

    // 7 ── Profiles
    for (let i = 0; i < (profiles || []).length; i++) {
      const selected = i === selectedProfileIdx;
      const hovered  = i === hoverProfileIdx;
      this._drawProfile(profiles[i], selected, hovered);
    }

    // 8 ── F1 handles
    if (phase === 3 && f1Handles) {
      for (let i = 0; i < f1Handles.length; i++) {
        this._drawHandle(f1Handles[i], i === f1SelectedHandle);
      }
    }

    // 9 ── Wind arrow (entry side indicator)
    this._drawWindArrow();

    ctx.restore();
  }

  // ── COORDINATE HELPERS ────────────────────────────────────────

  /** Virtual → canvas pixel */
  toCanvas(vx, vy) {
    return {
      cx: vx * this.scale + this.offsetX,
      cy: vy * this.scale + this.offsetY,
    };
  }

  /** Scale a virtual size to pixel size */
  px(v) { return v * this.scale; }

  // ── BACKGROUND & GRID ─────────────────────────────────────────

  _drawBackground() {
    const { canvas, ctx } = this;

    // Deep void
    ctx.fillStyle = C_BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dot grid (very faint)
    ctx.strokeStyle = C_GRID;
    ctx.lineWidth   = 1;
    const step = 80 * this.scale;
    const x0   = this.offsetX % step;
    const y0   = this.offsetY % step;

    ctx.beginPath();
    for (let x = x0; x < canvas.width; x += step) {
      ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
    }
    for (let y = y0; y < canvas.height; y += step) {
      ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();

    // CRT scanline overlay
    if (this._scanlinePattern) {
      ctx.fillStyle = this._scanlinePattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  _drawWindArrow() {
    // Subtle chevrons at the left edge indicating wind direction
    const ctx  = this.ctx;
    const { cy: midY } = this.toCanvas(0, 450);
    const step  = this.px(55);
    const arrow = this.px(12);

    ctx.strokeStyle = 'rgba(0,240,255,0.12)';
    ctx.lineWidth   = this.px(2.5);
    for (let i = 0; i < 4; i++) {
      const x = this.offsetX + i * step + this.px(15);
      ctx.beginPath();
      ctx.moveTo(x, midY - arrow);
      ctx.lineTo(x + arrow, midY);
      ctx.lineTo(x, midY + arrow);
      ctx.stroke();
    }
  }

  // ── OBSTACLES ─────────────────────────────────────────────────

  _drawObstacle(obs) {
    const ctx = this.ctx;
    const { cx, cy } = this.toCanvas(obs.x, obs.y);
    const cw = this.px(obs.w);
    const ch = this.px(obs.h);

    ctx.fillStyle   = C_SURFACE_HIGH;
    ctx.strokeStyle = C_OUTLINE_DIM;
    ctx.lineWidth   = this.px(3);

    // Scanline texture on obstacle
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeRect(cx, cy, cw, ch);

    // Label
    ctx.fillStyle  = C_OUTLINE_DIM;
    ctx.font       = `${this.px(9)}px 'Share Tech Mono', monospace`;
    ctx.fillText('OBSTACLE', cx + this.px(5), cy + ch * 0.5);
  }

  // ── TARGET ZONES ──────────────────────────────────────────────

  _drawTarget(target, time) {
    const ctx  = this.ctx;
    const { cx, cy } = this.toCanvas(target.x, target.y);
    const cw   = this.px(target.w);
    const ch   = this.px(target.h);
    const hit  = target._hitRate || 0;

    // Pulsing period
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.0);
    const glow  = 8 + pulse * 10 + hit * 20;

    // Fill: dim magenta, more intense when hit
    ctx.fillStyle = `rgba(255,82,92,${0.06 + hit * 0.18})`;
    ctx.fillRect(cx, cy, cw, ch);

    // Animated border
    ctx.strokeStyle = C_SECONDARY;
    ctx.lineWidth   = this.px(3.5);
    ctx.shadowColor = C_SECONDARY;
    ctx.shadowBlur  = glow * this.scale;
    ctx.strokeRect(cx, cy, cw, ch);
    ctx.shadowBlur  = 0;

    // Corner tick marks
    const tick = this.px(10);
    ctx.strokeStyle = C_SECONDARY;
    ctx.lineWidth   = this.px(2.5);
    this._drawCornerTicks(cx, cy, cw, ch, tick);

    // TARGET label
    ctx.fillStyle  = `rgba(255,82,92,${0.5 + hit * 0.5})`;
    ctx.font       = `${this.px(10)}px 'Share Tech Mono', monospace`;
    ctx.textAlign  = 'center';
    ctx.fillText('TARGET', cx + cw / 2, cy + this.px(14));
    ctx.textAlign  = 'left';

    // Hit percentage if meaningful
    if (hit > 0.02) {
      ctx.fillStyle = `rgba(255,82,92,${0.7 + hit * 0.3})`;
      ctx.font      = `${this.px(11)}px 'Share Tech Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${(hit * 100).toFixed(0)}%`, cx + cw / 2, cy + ch - this.px(8));
      ctx.textAlign = 'left';
    }
  }

  _drawCornerTicks(x, y, w, h, tick) {
    const ctx = this.ctx;
    const seg = [
      [[x, y + tick], [x, y], [x + tick, y]],
      [[x + w - tick, y], [x + w, y], [x + w, y + tick]],
      [[x, y + h - tick], [x, y + h], [x + tick, y + h]],
      [[x + w - tick, y + h], [x + w, y + h], [x + w, y + h - tick]],
    ];
    for (const [p1, p2, p3] of seg) {
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.lineTo(p3[0], p3[1]);
      ctx.stroke();
    }
  }

  // ── PARTICLES ─────────────────────────────────────────────────

  _drawParticles(particles, phase, f1Config, f1FlowProfiles, f1FlowObstacles) {
    if (phase === 3 && f1Config && f1FlowProfiles && f1FlowObstacles) {
      this._drawF1Streamlines(f1Config, f1FlowProfiles, f1FlowObstacles);
      return;
    }

    const ctx   = this.ctx;
    const scale = this.scale;

    for (const p of particles) {
      if (!p.active) continue;

      const { cx, cy } = this.toCanvas(p.x, p.y);
      const speed       = p.speed();
      const speedRatio  = Math.min(1, speed / 350);

      // Colour: cyan at slow → white at fast
      const r = Math.round(0   + speedRatio * 219);  // 0 → 219
      const g = Math.round(240 - speedRatio * 16);   // 240 → 224
      const b = Math.round(255 - speedRatio * 68);   // 255 → 187
      const alpha = 0.65 + speedRatio * 0.35;

      // Trail (drawn first so particle sits on top)
      if (p.trail.length > 1) {
        for (let t = 0; t < p.trail.length; t++) {
          const { cx: tx, cy: ty } = this.toCanvas(p.trail[t].x, p.trail[t].y);
          const ta  = (t / p.trail.length) * alpha * 0.4;
          ctx.fillStyle = `rgba(${r},${g},${b},${ta})`;
          const ts      = Math.max(0.5, scale * (0.8 + speedRatio));
          ctx.fillRect(tx - ts * 0.5, ty - ts * 0.5, ts, ts);
        }
      }

      // Particle dot
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      const ps       = Math.max(1, scale * (1.5 + speedRatio));
      ctx.fillRect(cx - ps * 0.5, cy - ps * 0.5, ps, ps);
    }
  }

  _drawF1Streamlines(f1Config, flowProfiles, flowObstacles) {
    const ctx = this.ctx;
    const seedCount = 24;
    const startX = TUNNEL.x + 10;
    const topY = TUNNEL.y + 36;
    const floorY = F1_LAYOUT.referenceY - 8;
    const bottomY = Math.min(TUNNEL.y + TUNNEL.h - 36, floorY - 14);
    const dashOffset = -this._time * 140;

    for (let i = 0; i < seedCount; i++) {
      const ratio = i / (seedCount - 1);
      const seedY = topY + (bottomY - topY) * ratio;
      const streamline = this._integrateStreamline(startX, seedY, f1Config, flowProfiles, flowObstacles);
      if (streamline.points.length < 4) continue;

      const avgSpeed = streamline.totalSpeed / streamline.points.length;
      const speedRatio = Math.min(1, avgSpeed / 1.45);
      const r = Math.round(0 + speedRatio * 219);
      const g = Math.round(240 - speedRatio * 16);
      const b = Math.round(255 - speedRatio * 68);

      this._strokeSmoothStreamline(streamline.points, {
        strokeStyle: `rgba(${r},${g},${b},${0.10 + speedRatio * 0.06})`,
        lineWidth: Math.max(this.px(0.9 + speedRatio * 0.35), 1),
        shadowColor: `rgba(${r},${g},${b},${0.08 + speedRatio * 0.05})`,
        shadowBlur: this.px(2 + speedRatio * 2),
      });

      ctx.save();
      ctx.setLineDash([this.px(18), this.px(26)]);
      ctx.lineDashOffset = dashOffset - i * this.px(7);
      this._strokeSmoothStreamline(streamline.points, {
        strokeStyle: `rgba(${r},${g},${b},${0.24 + speedRatio * 0.14})`,
        lineWidth: Math.max(this.px(1.1 + speedRatio * 0.45), 1),
        shadowColor: `rgba(${r},${g},${b},${0.16 + speedRatio * 0.08})`,
        shadowBlur: this.px(3.5 + speedRatio * 2.5),
      });
      ctx.restore();
    }

    ctx.shadowBlur = 0;
  }

  _integrateStreamline(startX, startY, f1Config, flowProfiles, flowObstacles) {
    const points = [{ x: startX, y: startY }];
    let x = startX;
    let y = startY;
    let totalSpeed = 0;
    const floorY = F1_LAYOUT.referenceY - 4;

    for (let stepIndex = 0; stepIndex < 120; stepIndex++) {
      const flow = this._sampleF1FlowField(x, y, f1Config, flowProfiles, flowObstacles);
      const mag = Math.max(0.001, Math.hypot(flow.vx, flow.vy));
      const step = 15;
      x += (flow.vx / mag) * step;
      y += (flow.vy / mag) * step;
      totalSpeed += mag;

      if (x > TUNNEL.x + TUNNEL.w - 8 || y < TUNNEL.y + 8 || y > floorY) {
        break;
      }

      points.push({ x, y });
    }

    return { points, totalSpeed };
  }

  _sampleF1FlowField(x, y, f1Config, flowProfiles, flowObstacles) {
    let vx = 1.05;
    let vy = 0;
    const groundPlaneY = F1_LAYOUT.referenceY;

    for (const profile of flowProfiles) {
      const { dist, tx, ty, nx, ny, tCurve } = profile.nearestPoint(x, y);
      if (dist > 170) continue;

      const tangentForward = tx >= 0 ? { x: tx, y: ty } : { x: -tx, y: -ty };
      const edgeFade = Math.min(tCurve * 4, (1 - tCurve) * 4, 1);
      const strength = Math.pow(1 - dist / 170, 2.2) * edgeFade;
      vx += tangentForward.x * (0.95 + strength * 1.10);
      vy += tangentForward.y * (0.95 + strength * 1.10);
      vx -= nx * 0.35 * strength;
      vy -= ny * 0.95 * strength;
    }

    const guideCurves = this._getF1GuideCurves(f1Config);
    for (const curve of guideCurves) {
      const guide = this._nearestPointOnPolyline(x, y, curve);
      if (!guide || guide.dist > 78) continue;
      const strength = Math.pow(1 - guide.dist / 78, 2.4);
      const tangentForward = guide.tx >= 0 ? { x: guide.tx, y: guide.ty } : { x: -guide.tx, y: -guide.ty };
      vx += tangentForward.x * (0.30 + strength * 0.95);
      vy += tangentForward.y * (0.30 + strength * 0.95);
      vx -= guide.nx * 0.22 * strength;
      vy -= guide.ny * 0.65 * strength;
    }

    const wingBias = this._sampleWingUpwash(x, y, f1Config);
    vx += wingBias.vx;
    vy += wingBias.vy;

    for (const obstacle of flowObstacles) {
      const marginX = 120;
      const marginY = 90;
      if (x < obstacle.x - marginX || x > obstacle.x + obstacle.w + marginX) continue;
      if (y < obstacle.y - marginY || y > obstacle.y + obstacle.h + marginY) continue;

      const centerY = obstacle.y + obstacle.h * 0.5;
      const normX = (x - (obstacle.x + obstacle.w * 0.5)) / (obstacle.w * 0.5 + marginX);
      const normY = (y - centerY) / (obstacle.h * 0.5 + marginY);
      const falloff = Math.max(0, 1 - normX * normX - normY * normY);
      const direction = y <= centerY ? -1 : 1;
      vx += 0.20 * falloff;
      vy += direction * 0.85 * falloff;
    }

    const gc = f1Config.groundClearance;
    const underfloorStart = F1_LAYOUT.baseX + 170;
    const underfloorEnd = F1_LAYOUT.baseX + 700;
    const underfloorCeilingY = F1_LAYOUT.referenceY - gc - 18;
    if (x >= underfloorStart && x <= underfloorEnd && y >= underfloorCeilingY && y <= underfloorCeilingY + 80) {
      const floorRatio = 1 - Math.min(1, Math.abs(y - (underfloorCeilingY + 28)) / 64);
      vx += 0.35 * floorRatio;
      vy -= 0.12 * floorRatio;
    }

    if (y >= groundPlaneY - 36) {
      const floorRatio = Math.max(0, 1 - (groundPlaneY - y) / 36);
      vy -= 0.85 * floorRatio * floorRatio;
      vx += 0.10 * floorRatio;
    }

    return { vx, vy };
  }

  _sampleWingUpwash(x, y, f1Config) {
    const gc = f1Config.groundClearance;
    const front = this._sampleSingleWingUpwash({
      x, y,
      pivotX: F1_LAYOUT.baseX + 72,
      pivotY: F1_LAYOUT.referenceY - gc - 26,
      angleDeg: f1Config.frontWingAngle,
      chord: 205,
      magnitude: 0.85,
    });
    const rear = this._sampleSingleWingUpwash({
      x, y,
      pivotX: F1_LAYOUT.baseX + 700,
      pivotY: F1_LAYOUT.referenceY - gc - 108,
      angleDeg: f1Config.rearWingAngle,
      chord: 195,
      magnitude: 1.15,
    });

    return {
      vx: front.vx + rear.vx,
      vy: front.vy + rear.vy,
    };
  }

  _sampleSingleWingUpwash({ x, y, pivotX, pivotY, angleDeg, chord, magnitude }) {
    const rad = angleDeg * Math.PI / 180;
    const dx = x - pivotX;
    const dy = y - pivotY;
    const localX = dx * Math.cos(rad) + dy * Math.sin(rad);
    const localY = -dx * Math.sin(rad) + dy * Math.cos(rad);
    const angleFactor = Math.min(1, Math.max(0, angleDeg / 30));
    const trailingEdgeX = chord * 0.66;
    if (angleFactor <= 0.01) return { vx: 0, vy: 0 };

    let vx = 0;
    let vy = 0;

    const topWakeStart = trailingEdgeX;
    const topWakeEnd = trailingEdgeX + chord * 0.95;
    if (localX >= topWakeStart && localX <= topWakeEnd) {
      const topWakeX = (localX - topWakeStart) / (topWakeEnd - topWakeStart);
      const topWakeY = (localY + 24) / 46;
      const topWake = Math.max(0, 1 - Math.pow(topWakeX - 0.18, 2) / 0.72 - topWakeY * topWakeY);
      if (topWake > 0) {
        vx += 0.12 * topWake * angleFactor;
        vy -= magnitude * topWake * angleFactor;
      }
    }

    const trailingStart = trailingEdgeX + chord * 0.10;
    const trailingEnd = trailingEdgeX + chord * 1.05;
    if (localX >= trailingStart && localX <= trailingEnd) {
      const trailingX = (localX - trailingStart) / (trailingEnd - trailingStart);
      const trailingY = (localY + 6) / 60;
      const trailingWake = Math.max(0, 1 - Math.pow(trailingX - 0.12, 2) / 0.78 - trailingY * trailingY);
      if (trailingWake > 0) {
        vx += 0.18 * trailingWake * angleFactor;
        vy -= magnitude * 0.55 * trailingWake * angleFactor;
      }
    }

    return { vx, vy };
  }

  _getF1GuideCurves(f1Config) {
    const gc = f1Config.groundClearance;
    const baseX = F1_LAYOUT.baseX;
    const groundY = F1_LAYOUT.referenceY;

    return [
      [
        { x: baseX + 220, y: groundY - gc - 48 },
        { x: baseX + 300, y: groundY - gc - 58 },
        { x: baseX + 380, y: groundY - gc - 72 },
        { x: baseX + 450, y: groundY - gc - 88 },
        { x: baseX + 540, y: groundY - gc - 92 },
        { x: baseX + 620, y: groundY - gc - 84 },
        { x: baseX + 700, y: groundY - gc - 72 },
        { x: baseX + 760, y: groundY - gc - 58 },
      ],
      [
        { x: baseX + 160, y: groundY - gc - 20 },
        { x: baseX + 320, y: groundY - gc - 20 },
        { x: baseX + 500, y: groundY - gc - 22 },
        { x: baseX + 640, y: groundY - gc - 22 },
        { x: baseX + 740, y: groundY - gc - 16 },
        { x: baseX + 835, y: groundY - gc - 28 },
      ],
    ];
  }

  _nearestPointOnPolyline(px, py, points) {
    let best = null;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const abX = b.x - a.x;
      const abY = b.y - a.y;
      const len2 = abX * abX + abY * abY || 1;
      const t = Math.max(0, Math.min(1, ((px - a.x) * abX + (py - a.y) * abY) / len2));
      const qx = a.x + abX * t;
      const qy = a.y + abY * t;
      const dx = px - qx;
      const dy = py - qy;
      const dist = Math.hypot(dx, dy);
      if (!best || dist < best.dist) {
        const segLen = Math.hypot(abX, abY) || 1;
        best = {
          dist,
          tx: abX / segLen,
          ty: abY / segLen,
          nx: dist > 0.001 ? dx / dist : -abY / segLen,
          ny: dist > 0.001 ? dy / dist : abX / segLen,
        };
      }
    }
    return best;
  }

  _strokeSmoothStreamline(points, style) {
    const ctx = this.ctx;
    ctx.strokeStyle = style.strokeStyle;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = style.shadowBlur;

    ctx.beginPath();
    const first = this.toCanvas(points[0].x, points[0].y);
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < points.length - 1; i++) {
      const current = this.toCanvas(points[i].x, points[i].y);
      const next = this.toCanvas(points[i + 1].x, points[i + 1].y);
      const midX = (current.cx + next.cx) * 0.5;
      const midY = (current.cy + next.cy) * 0.5;
      ctx.quadraticCurveTo(current.cx, current.cy, midX, midY);
    }
    const penultimate = this.toCanvas(points[points.length - 2].x, points[points.length - 2].y);
    const tail = this.toCanvas(points[points.length - 1].x, points[points.length - 1].y);
    ctx.quadraticCurveTo(penultimate.cx, penultimate.cy, tail.cx, tail.cy);
    ctx.stroke();
  }

  // ── PROFILES ──────────────────────────────────────────────────

  _drawProfile(profile, selected, hovered) {
    const ctx   = this.ctx;
    const pts   = profile.getWorldPoints();
    if (pts.length < 2) return;

    const color = selected ? C_SECONDARY : C_PRIMARY;
    const blur  = selected ? 18 : (hovered ? 14 : 10);

    // Profile body fill (semi-transparent surface)
    ctx.beginPath();
    const first = this.toCanvas(pts[0].x, pts[0].y);
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < pts.length; i++) {
      const pt = this.toCanvas(pts[i].x, pts[i].y);
      ctx.lineTo(pt.cx, pt.cy);
    }
    // "Close" with a thin parallel path below (gives a sense of thickness)
    const last = this.toCanvas(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.lineTo(last.cx + 0.5, last.cy + this.px(6));
    for (let i = pts.length - 2; i >= 0; i--) {
      const pt = this.toCanvas(pts[i].x, pts[i].y);
      ctx.lineTo(pt.cx, pt.cy + this.px(6));
    }
    ctx.closePath();

    ctx.fillStyle   = selected
      ? 'rgba(42,20,24,0.75)'
      : 'rgba(20,35,42,0.75)';
    ctx.fill();

    // Neon stroke
    ctx.beginPath();
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < pts.length; i++) {
      const pt = this.toCanvas(pts[i].x, pts[i].y);
      ctx.lineTo(pt.cx, pt.cy);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth   = this.px(4);
    ctx.shadowColor = color;
    ctx.shadowBlur  = blur * this.scale;
    ctx.lineJoin    = 'miter';
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // Flow direction indicator at trailing edge
    const lastPt = pts[pts.length - 1];
    const prevPt = pts[pts.length - 3] || pts[0];
    const dirX   = lastPt.x - prevPt.x;
    const dirY   = lastPt.y - prevPt.y;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    const uDirX  = dirX / dirLen;
    const uDirY  = dirY / dirLen;

    const { cx: ex, cy: ey } = this.toCanvas(lastPt.x, lastPt.y);
    const arrLen = this.px(14);
    ctx.strokeStyle = color;
    ctx.lineWidth   = this.px(2);
    ctx.shadowColor = color;
    ctx.shadowBlur  = 6 * this.scale;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex + uDirX * arrLen, ey + uDirY * arrLen);
    // Arrowhead
    const perpX = -uDirY * arrLen * 0.35;
    const perpY =  uDirX * arrLen * 0.35;
    const tipX  = ex + uDirX * arrLen;
    const tipY  = ey + uDirY * arrLen;
    ctx.moveTo(tipX - perpX - uDirX * 6 * this.scale, tipY - perpY - uDirY * 6 * this.scale);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX + perpX - uDirX * 6 * this.scale, tipY + perpY - uDirY * 6 * this.scale);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Centre handle (drag indicator)
    this._drawProfileHandle(profile, selected, hovered);
  }

  _drawProfileHandle(profile, selected, hovered) {
    const ctx   = this.ctx;
    const { cx, cy } = this.toCanvas(profile.x, profile.y);
    const size  = Math.max(this.px(10), 14); // min 14px for touch targets
    const color = selected ? C_SECONDARY : (hovered ? C_PRIMARY : 'rgba(0,240,255,0.5)');

    ctx.strokeStyle = color;
    ctx.lineWidth   = this.px(2.5);
    ctx.shadowColor = color;
    ctx.shadowBlur  = selected ? 12 * this.scale : 6 * this.scale;

    // Square handle (0px radius per DESIGN.md)
    ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);

    // Crosshair lines
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.8, cy);
    ctx.lineTo(cx + size * 0.8, cy);
    ctx.moveTo(cx, cy - size * 0.8);
    ctx.lineTo(cx, cy + size * 0.8);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Rotate hint (small arc around handle when not selected)
    if (!selected && !hovered) {
      ctx.strokeStyle = 'rgba(0,240,255,0.2)';
      ctx.lineWidth   = this.px(1.5);
      ctx.beginPath();
      ctx.arc(cx, cy, size * 1.5, -Math.PI * 0.6, Math.PI * 0.6);
      ctx.stroke();
    }
  }

  // ── F1 CAR (PHASE 3) ──────────────────────────────────────────

  _drawF1Car(cfg) {
    const ctx  = this.ctx;
    const {
      frontWingAngle, rearWingAngle, diffAngle, groundClearance,
      baseX = F1_LAYOUT.baseX,
    } = cfg;

    const groundY = F1_LAYOUT.referenceY;
    const carY    = this.toCanvas(0, groundY - groundClearance).cy;
    const gndY    = this.toCanvas(0, groundY).cy;

    // ── Local ride-height reference, not a full-width floor
    if (groundClearance > 0) {
      ctx.strokeStyle = 'rgba(255,183,127,0.4)';
      ctx.setLineDash([this.px(4), this.px(6)]);
      ctx.lineWidth   = this.px(1);
      const { cx: baseVX } = this.toCanvas(baseX + 150, 0);
      const { cx: topVX  } = this.toCanvas(baseX + 770, 0);
      ctx.beginPath();
      ctx.moveTo(baseVX, carY + this.px(70));
      ctx.lineTo(topVX, carY + this.px(70));
      ctx.moveTo(baseVX, gndY);
      ctx.lineTo(topVX, gndY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle  = 'rgba(255,183,127,0.7)';
      ctx.font       = `${this.px(9)}px 'Share Tech Mono', monospace`;
      ctx.fillText(`h=${groundClearance.toFixed(0)}`, this.toCanvas(baseX + 575, 0).cx, (carY + this.px(70) + gndY) / 2 + this.px(4));
    }

    // ── Main body polygon (angular / cyberpunk F1 side profile)
    const bx = (vx) => this.toCanvas(vx, 0).cx;
    const by = (vy) => this.toCanvas(0, vy).cy;

    // Adjust all Y positions by groundClearance
    const Y = (y) => this.toCanvas(0, groundY - groundClearance + (y - groundY)).cy;

    // Body shape points (virtual coords, relative to car center)
    const bodyPts = [
      [baseX + 30,  groundY - 20],   // nose tip (bottom)
      [baseX + 30,  groundY - 50],   // nose top
      [baseX + 90,  groundY - 60],   // nose root
      [baseX + 200, groundY - 70],   // cockpit front
      [baseX + 290, groundY - 80],   // cockpit step
      [baseX + 340, groundY - 95],   // cockpit top
      [baseX + 420, groundY - 90],   // cockpit rear
      [baseX + 520, groundY - 78],   // engine
      [baseX + 620, groundY - 75],   // gearbox
      [baseX + 700, groundY - 65],   // rear wing support
      [baseX + 740, groundY - 55],   // tail
      [baseX + 740, groundY - 22],   // tail bottom-right
      [baseX + 640, groundY - 22],   // diffuser start
      [baseX + 200, groundY - 20],   // floor
    ];

    this._drawCarShape(bodyPts, cfg, groundY);

    // ── Front wing
    this._drawFrontWing(cfg, groundY);

    // ── Rear wing
    this._drawRearWing(cfg, groundY);

    // ── Diffuser
    this._drawDiffuser(cfg, groundY);
  }

  _drawCarShape(pts, cfg, groundY) {
    const ctx  = this.ctx;
    const gc   = cfg.groundClearance;

    ctx.beginPath();
    let first = this.toCanvas(pts[0][0], pts[0][1] - gc);
    ctx.moveTo(first.cx, first.cy);
    for (let i = 1; i < pts.length; i++) {
      const p = this.toCanvas(pts[i][0], pts[i][1] - gc);
      ctx.lineTo(p.cx, p.cy);
    }
    ctx.closePath();

    // Fill with surface texture
    ctx.fillStyle = C_SURFACE_HIGH;
    ctx.fill();

    // Scanline on body
    const scanPat = this._scanlinePattern;
    if (scanPat) {
      ctx.fillStyle = scanPat;
      ctx.fill();
    }

    // Neon outline
    ctx.strokeStyle = C_PRIMARY;
    ctx.lineWidth   = this.px(3);
    ctx.shadowColor = C_PRIMARY;
    ctx.shadowBlur  = 10 * this.scale;
    ctx.stroke();
    ctx.shadowBlur  = 0;
  }

  _drawFrontWing(cfg, groundY) {
    const { frontWingAngle, groundClearance, baseX = F1_LAYOUT.baseX } = cfg;
    const gc   = groundClearance;
    this._drawWingElement({
      pivotX: baseX + 72,
      pivotY: groundY - 26 - gc,
      angleDeg: frontWingAngle,
      chord: 205,
      camber: 16,
      thickness: 8,
      color: C_TERTIARY,
      endplateColor: C_TERTIARY,
    });
  }

  _drawRearWing(cfg, groundY) {
    const ctx  = this.ctx;
    const { rearWingAngle, groundClearance, baseX = F1_LAYOUT.baseX } = cfg;
    const gc   = groundClearance;

    // Vertical strut
    const strutX  = baseX + 700;
    const strutY1 = groundY - 22 - gc;
    const strutY2 = groundY - 104 - gc;

    const pStrutBot = this.toCanvas(strutX, strutY1);
    const pStrutTop = this.toCanvas(strutX, strutY2);

    ctx.strokeStyle = C_PRIMARY;
    ctx.lineWidth   = this.px(3);
    ctx.shadowColor = C_PRIMARY;
    ctx.shadowBlur  = 8 * this.scale;
    ctx.beginPath();
    ctx.moveTo(pStrutBot.cx, pStrutBot.cy);
    ctx.lineTo(pStrutTop.cx, pStrutTop.cy);
    ctx.stroke();

    this._drawWingElement({
      pivotX: strutX,
      pivotY: strutY2 - 4,
      angleDeg: rearWingAngle,
      chord: 195,
      camber: 18,
      thickness: 10,
      color: C_SECONDARY,
      endplateColor: C_SECONDARY,
    });
  }

  _drawDiffuser(cfg, groundY) {
    const ctx  = this.ctx;
    const { diffAngle, groundClearance, baseX = F1_LAYOUT.baseX } = cfg;
    const gc   = groundClearance;
    const rad  = diffAngle * Math.PI / 180;

    // Diffuser exits from rear undertray
    const diffStartX = baseX + 640;
    const diffStartY = groundY - 22 - gc;
    const diffEndX   = baseX + 740;
    const diffEndY   = diffStartY + 6;

    // Diffuser exits rearward (+x) and upward (-y) — correct for under-car airflow.
    const len    = 100;
    const exitX  = diffEndX + len * Math.cos(rad);   // rightward (behind car)
    const exitY  = diffEndY - len * Math.sin(rad);   // upward (diffuser opens)

    const pS = this.toCanvas(diffStartX, diffStartY);
    const pE = this.toCanvas(diffEndX, diffEndY);
    const pX = this.toCanvas(exitX, exitY);

    ctx.strokeStyle = C_TERTIARY;
    ctx.lineWidth   = this.px(4);
    ctx.shadowColor = C_TERTIARY;
    ctx.shadowBlur  = 10 * this.scale;
    ctx.beginPath();
    ctx.moveTo(pS.cx, pS.cy);
    ctx.lineTo(pE.cx, pE.cy);
    ctx.lineTo(pX.cx, pX.cy);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  _drawWingElement({ pivotX, pivotY, angleDeg, chord, camber, thickness, color, endplateColor }) {
    const ctx = this.ctx;
    const rad = -angleDeg * Math.PI / 180;
    const samples = 16;
    const pivotFrac = 0.34;
    const upper = [];
    const lower = [];

    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const localX = -chord * pivotFrac + t * chord;
      const camberY = (4 * camber * t * (1 - t)) * (0.80 - 0.25 * t);
      const localThickness = thickness * Math.sin(Math.PI * t) * (0.45 + 0.55 * (1 - t));
      upper.push(this._rotateWingPoint(localX, camberY - localThickness * 0.5, pivotX, pivotY, rad));
      lower.push(this._rotateWingPoint(localX, camberY + localThickness * 0.5, pivotX, pivotY, rad));
    }

    ctx.fillStyle = 'rgba(18,18,24,0.88)';
    ctx.strokeStyle = color;
    ctx.lineWidth = this.px(3);
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * this.scale;
    ctx.beginPath();
    let p = this.toCanvas(upper[0].x, upper[0].y);
    ctx.moveTo(p.cx, p.cy);
    for (let i = 1; i < upper.length; i++) {
      p = this.toCanvas(upper[i].x, upper[i].y);
      ctx.lineTo(p.cx, p.cy);
    }
    for (let i = lower.length - 1; i >= 0; i--) {
      p = this.toCanvas(lower[i].x, lower[i].y);
      ctx.lineTo(p.cx, p.cy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const lead = this.toCanvas(upper[0].x, upper[0].y);
    const lead2 = this.toCanvas(lower[0].x, lower[0].y);
    const trail = this.toCanvas(upper[upper.length - 1].x, upper[upper.length - 1].y);
    const trail2 = this.toCanvas(lower[lower.length - 1].x, lower[lower.length - 1].y);
    ctx.strokeStyle = endplateColor;
    ctx.lineWidth = this.px(2.5);
    ctx.beginPath();
    ctx.moveTo(lead.cx, lead.cy - this.px(7));
    ctx.lineTo(lead2.cx, lead2.cy + this.px(7));
    ctx.moveTo(trail.cx, trail.cy - this.px(7));
    ctx.lineTo(trail2.cx, trail2.cy + this.px(7));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  _rotateWingPoint(x, y, pivotX, pivotY, rad) {
    return {
      x: pivotX + x * Math.cos(rad) - y * Math.sin(rad),
      y: pivotY + x * Math.sin(rad) + y * Math.cos(rad),
    };
  }

  // ── F1 DRAG HANDLES ───────────────────────────────────────────

  _drawHandle(handle, selected) {
    const ctx  = this.ctx;
    const { cx, cy } = this.toCanvas(handle.x, handle.y);
    const size  = Math.max(this.px(14), 18); // generoud touch target
    const color = selected ? C_SECONDARY : C_TERTIARY;

    ctx.strokeStyle = color;
    ctx.lineWidth   = this.px(3);
    ctx.shadowColor = color;
    ctx.shadowBlur  = (selected ? 18 : 10) * this.scale;

    // Outer square
    ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);

    // Inner diamond
    const d = size * 0.35;
    ctx.beginPath();
    ctx.moveTo(cx, cy - d);
    ctx.lineTo(cx + d, cy);
    ctx.lineTo(cx, cy + d);
    ctx.lineTo(cx - d, cy);
    ctx.closePath();
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Label above handle
    if (handle.label) {
      ctx.fillStyle  = color;
      ctx.font       = `${this.px(9)}px 'Share Tech Mono', monospace`;
      ctx.textAlign  = 'center';
      ctx.fillText(handle.label, cx, cy - size / 2 - this.px(5));
      ctx.textAlign  = 'left';
    }
  }

  // ── UTILITY ───────────────────────────────────────────────────

  /** Draw a neon flash overlay (for glitch transition effect) */
  drawFlash(alpha = 0.4) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = C_PRIMARY;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  /** Draw a "level complete" overlay flash */
  drawCompleteFlash(alpha) {
    this.drawFlash(alpha * 0.3);
  }

  // ── SANDBOX MODE RENDERING ─────────────────────────────────────

  drawSandboxFrame(state) {
    const { shapes, currentDraw, isDrawing, particles, time } = state;
    const ctx = this.ctx;
    this._time = time;

    ctx.save();

    // 1 ── Background
    this._drawBackground();

    // 2 ── Wind direction chevrons
    this._drawWindArrow();

    // 3 ── Draw completed shapes (filled with semi-transparent neon + glow stroke)
    for (const shape of shapes) {
      this._drawSandboxShape(shape, time);
    }

    // 4 ── Draw in-progress shape (dashed neon line)
    if (currentDraw && currentDraw.points.length > 1) {
      this._drawSandboxCurrentDraw(currentDraw);
    }

    // 5 ── Particles (additive blending)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this._drawSandboxParticles(particles);
    ctx.restore();

    ctx.restore();
  }

  _drawSandboxShape(shape, time) {
    const ctx = this.ctx;
    const pts = shape.points;
    if (!pts || pts.length < 3) return;

    // Build smooth path using quadratic Bézier through midpoints
    ctx.beginPath();
    this._traceSmoothPath(pts, true);  // closed=true

    // Semi-transparent fill
    ctx.fillStyle = 'rgba(20,35,42,0.7)';
    ctx.fill();

    // Scanline texture on shape
    const scanPat = this._scanlinePattern;
    if (scanPat) {
      ctx.fillStyle = scanPat;
      ctx.fill();
    }

    // Neon stroke with glow
    const pulse = 0.7 + 0.3 * Math.sin(time * 2.0);
    ctx.strokeStyle = C_PRIMARY;
    ctx.lineWidth   = this.px(3);
    ctx.shadowColor = C_PRIMARY;
    ctx.shadowBlur  = (10 + pulse * 6) * this.scale;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.shadowBlur  = 0;
  }

  _drawSandboxCurrentDraw(draw) {
    const ctx = this.ctx;
    const pts = draw.points;
    if (pts.length < 2) return;

    // Smooth curve through the points being drawn
    ctx.beginPath();
    this._traceSmoothPath(pts, false);  // open path

    // Solid neon line (no dash — feels more like drawing)
    ctx.strokeStyle = 'rgba(0,240,255,0.8)';
    ctx.lineWidth   = this.px(3);
    ctx.shadowColor = C_PRIMARY;
    ctx.shadowBlur  = 10 * this.scale;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // Draw closing line (dimmer) from last point to first
    if (pts.length > 5) {
      const last  = this.toCanvas(pts[pts.length - 1].x, pts[pts.length - 1].y);
      const first = this.toCanvas(pts[0].x, pts[0].y);
      ctx.beginPath();
      ctx.moveTo(last.cx, last.cy);
      ctx.lineTo(first.cx, first.cy);
      ctx.setLineDash([this.px(4), this.px(8)]);
      ctx.strokeStyle = 'rgba(0,240,255,0.2)';
      ctx.lineWidth   = this.px(1.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Start point marker
    const sp = this.toCanvas(pts[0].x, pts[0].y);
    ctx.fillStyle = C_PRIMARY;
    ctx.shadowColor = C_PRIMARY;
    ctx.shadowBlur  = 8 * this.scale;
    ctx.beginPath();
    ctx.arc(sp.cx, sp.cy, this.px(4), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /**
   * Trace a smooth path through points using quadratic Bézier curves.
   * Each segment uses the actual point as the control point and the
   * midpoint between consecutive points as the on-curve point.
   * This produces perfectly smooth, continuous C1-continuous curves.
   */
  _traceSmoothPath(pts, closed) {
    if (pts.length < 2) return;

    const canvasPts = pts.map(p => this.toCanvas(p.x, p.y));

    if (canvasPts.length === 2) {
      this.ctx.moveTo(canvasPts[0].cx, canvasPts[0].cy);
      this.ctx.lineTo(canvasPts[1].cx, canvasPts[1].cy);
      return;
    }

    const ctx = this.ctx;

    if (closed) {
      // For closed shapes: start at midpoint between first and second
      const first = canvasPts[0];
      const second = canvasPts[1];
      ctx.moveTo(
        (first.cx + second.cx) * 0.5,
        (first.cy + second.cy) * 0.5
      );
      for (let i = 1; i < canvasPts.length - 1; i++) {
        const cp = canvasPts[i];
        const next = canvasPts[i + 1];
        ctx.quadraticCurveTo(
          cp.cx, cp.cy,
          (cp.cx + next.cx) * 0.5,
          (cp.cy + next.cy) * 0.5
        );
      }
      // Close back to start
      const last = canvasPts[canvasPts.length - 1];
      ctx.quadraticCurveTo(
        last.cx, last.cy,
        (last.cx + first.cx) * 0.5,
        (last.cy + first.cy) * 0.5
      );
      ctx.quadraticCurveTo(
        first.cx, first.cy,
        (first.cx + second.cx) * 0.5,
        (first.cy + second.cy) * 0.5
      );
      ctx.closePath();
    } else {
      // Open path: start at first point
      ctx.moveTo(canvasPts[0].cx, canvasPts[0].cy);
      // Line to first midpoint
      if (canvasPts.length > 2) {
        ctx.lineTo(
          (canvasPts[0].cx + canvasPts[1].cx) * 0.5,
          (canvasPts[0].cy + canvasPts[1].cy) * 0.5
        );
        for (let i = 1; i < canvasPts.length - 1; i++) {
          const cp = canvasPts[i];
          const next = canvasPts[i + 1];
          ctx.quadraticCurveTo(
            cp.cx, cp.cy,
            (cp.cx + next.cx) * 0.5,
            (cp.cy + next.cy) * 0.5
          );
        }
        // Line to last point
        const last = canvasPts[canvasPts.length - 1];
        ctx.lineTo(last.cx, last.cy);
      } else {
        ctx.lineTo(canvasPts[1].cx, canvasPts[1].cy);
      }
    }
  }

  _drawSandboxParticles(particles) {
    const ctx   = this.ctx;
    const scale = this.scale;

    for (const p of particles) {
      if (!p.active) continue;

      const { cx, cy } = this.toCanvas(p.x, p.y);
      const speed       = p.speed();
      const speedRatio  = Math.min(1, speed / 350);

      // Colour: cyan at slow → white at fast
      const r = Math.round(0   + speedRatio * 219);
      const g = Math.round(240 - speedRatio * 16);
      const b = Math.round(255 - speedRatio * 68);
      const alpha = 0.55 + speedRatio * 0.45;

      // Draw continuous stream line (streak) instead of dots
      ctx.beginPath();
      // Start at oldest point in trail
      if (p.trail.length > 0) {
        let first = true;
        for (let t = 0; t < p.trail.length; t++) {
          const { cx: tx, cy: ty } = this.toCanvas(p.trail[t].x, p.trail[t].y);
          if (first) {
            ctx.moveTo(tx, ty);
            first = false;
          } else {
            ctx.lineTo(tx, ty);
          }
        }
        ctx.lineTo(cx, cy); // connect to current pos
      } else {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - p.vx * 0.05 * scale, cy - p.vy * 0.05 * scale); // small line if no trail
      }

      // Stroke thickest/brightest at the head, fading to tail
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * 0.6})`;
      const lw = Math.max(0.5, scale * (1.5 + speedRatio));
      
      // We can simulate an fading line by creating a linear gradient or using a solid semitransparent line
      // Given many particles, simple stroke is best for perf
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Bright dot at the head
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, lw * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
