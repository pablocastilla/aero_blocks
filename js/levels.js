/**
 * levels.js — Level Definitions
 *
 * 9 levels across 3 phases.
 * All positions are in virtual 1600×900 coordinate space.
 *
 * TUNNEL bounds (shared): { x:80, y:120, w:1440, h:660 }
 * Wind entry band: ~y 380–530 by default (varies per level)
 *
 * Phase 1 (COANDA DEFLECTION): 1 draggable profile, 1+ fixed targets
 * Phase 2 (DUAL ROUTING):      2 draggable profiles, targets behind obstacles
 * Phase 3 (F1 CONFIGURATOR):   fixed F1 car, drag handles to tune Cd/Cl
 */

'use strict';

// Shared tunnel bounds
const TUNNEL = { x: 80, y: 120, w: 1440, h: 660 };

// Score thresholds [1-star, 2-star, 3-star]
// For phases 1&2: fraction of particles in target (0‑1)
// For phase  3:   closeness score (0‑1)
const T_EASY   = [0.30, 0.55, 0.80];
const T_MEDIUM = [0.25, 0.50, 0.75];
const T_HARD   = [0.20, 0.45, 0.70];

const LEVELS = [

  // ────────────────────────────────────────────────────────────
  // PHASE 1 — COANDA DEFLECTION
  // ────────────────────────────────────────────────────────────

  {
    id: '1-1',
    phase: 1, levelNum: 1,
    name: 'FIRST CONTACT',
    description: 'Place the deflector above the stream so particles flow along its underside—the Coanda effect curves them upward.',

    wind: { speed: 290, angle: 0 },
    spawnBandY:  480, spawnBandH: 80,  // lower stream, tighter band

    profiles: [
      { type: 'arc', x: 400, y: 300, angle: 0, draggable: true,
        minX: 200, maxX: 1000, minY: 200, maxY: 700 },
    ],
    obstacles: [],
    targets: [
      { x: 1200, y: 120, w: 180, h: 220 },
    ],
    thresholds: T_EASY,

    // Hint text
    hint: 'DRAG the deflector DOWN into the airstream. Particles flowing underneath will follow the curve upward toward the target.',
  },

  {
    id: '1-2',
    phase: 1, levelNum: 2,
    name: 'SHARP TURN',
    description: 'Deflect the inlet stream downward—past the center line—into the lower zone.',

    wind: { speed: 240, angle: 0 },
    spawnBandY:  390, spawnBandH: 100,

    profiles: [
      { type: 'arc', x: 680, y: 430, angle: 175, draggable: true,
        minX: 300, maxX: 1100, minY: 180, maxY: 820 },
    ],
    obstacles: [],
    targets: [
      { x: 1300, y: 570, w: 140, h: 140 },
    ],
    thresholds: T_EASY,
    hint: 'Invert the deflector (180°) to push flow downward.',
  },

  {
    id: '1-3',
    phase: 1, levelNum: 3,
    name: 'DOUBLE BOUNCE',
    description: 'One baffle blocks every direct path. Two deflectors are needed: the first lifts flow above the baffle, the second bends it up into the target zone.',

    wind: { speed: 230, angle: 0 },
    spawnBandY: 470, spawnBandH: 80,

    profiles: [
      // Arc 1 — drag DOWN: lift spawn stream above the baffle
      { type: 'arc', x: 370, y: 120, angle: 0, draggable: true,
        minX: 150, maxX: 700, minY: 80, maxY: 760 },
      // Arc 2 — drag UP: redirect the lifted stream into the top target
      { type: 'arc', x: 880, y: 740, angle: 175, draggable: true,
        minX: 480, maxX: 1180, minY: 80, maxY: 760 },
    ],
    obstacles: [
      { type: 'wall', x: 620, y: 420, w: 30, h: 370, label: 'BAFFLE-A' },
    ],
    targets: [
      { x: 1270, y: 80, w: 160, h: 180 },
    ],
    thresholds: T_MEDIUM,
    hint: 'Arc 1 clears the baffle. Arc 2 aims the stream up into the target. Both are needed for 3 stars.',
  },

  // ────────────────────────────────────────────────────────────
  // PHASE 2 — DUAL ROUTING
  // ────────────────────────────────────────────────────────────

  {
    id: '2-1',
    phase: 2, levelNum: 1,
    name: 'SPLIT STREAM',
    description: 'Two targets. One deflector per routing layer. Split the stream to fill both zones.',

    wind: { speed: 220, angle: 0 },
    spawnBandY:  390, spawnBandH: 140,

    profiles: [
      { type: 'arc', x: 600, y: 390, angle: 340, draggable: true,
        minX: 180, maxX: 1050, minY: 150, maxY: 750 },
      { type: 'vane', x: 760, y: 510, angle: 20, draggable: true,
        minX: 180, maxX: 1050, minY: 200, maxY: 820 },
    ],
    obstacles: [],
    targets: [
      { x: 1290, y: 190, w: 130, h: 130 },
      { x: 1290, y: 580, w: 130, h: 130 },
    ],
    thresholds: T_MEDIUM,
    hint: 'Position profile A to deflect upper flow UP. Profile B to redirect lower flow DOWN.',
  },

  {
    id: '2-2',
    phase: 2, levelNum: 2,
    name: 'CHICANE',
    description: 'A central wall blocks the target. Chain two deflections to route flow around both sides.',

    wind: { speed: 235, angle: 0 },
    spawnBandY:  380, spawnBandH: 130,

    profiles: [
      { type: 'arc',  x: 560, y: 380, angle: 350, draggable: true,
        minX: 180, maxX: 900,  minY: 150, maxY: 750 },
      { type: 'foil', x: 870, y: 580, angle: 15, draggable: true,
        minX: 400, maxX: 1200, minY: 200, maxY: 810 },
    ],
    obstacles: [
      { type: 'wall', x: 780, y: 310, w: 30, h: 290, label: 'CHICANE' },
    ],
    targets: [
      { x: 1320, y: 530, w: 150, h: 150 },
    ],
    thresholds: T_MEDIUM,
    hint: 'Deflect UP over the wall with profile A, then DOWN toward target with profile B.',
  },

  {
    id: '2-3',
    phase: 2, levelNum: 3,
    name: 'OSCILLATOR',
    description: 'The target oscillates vertically. Maintain continuous flow as the zone moves.',

    wind: { speed: 245, angle: 0 },
    spawnBandY:  385, spawnBandH: 120,

    profiles: [
      { type: 'arc',  x: 580, y: 400, angle: 345, draggable: true,
        minX: 200, maxX: 950,  minY: 150, maxY: 780 },
      { type: 'foil', x: 820, y: 430, angle: 5, draggable: true,
        minX: 400, maxX: 1200, minY: 150, maxY: 780 },
    ],
    obstacles: [],
    targets: [
      // x/y are baseline; main.js animates y with oscillator
      { x: 1290, y: 280, w: 130, h: 145, oscillate: true,
        oscAmplitude: 220, oscPeriod: 3.2 },
    ],
    thresholds: T_HARD,
    hint: 'Build a wide deflection channel so the stream keeps hitting the moving target.',
  },

  // ────────────────────────────────────────────────────────────
  // PHASE 3 — F1 CONFIGURATOR
  // ────────────────────────────────────────────────────────────

  {
    id: '3-1',
    phase: 3, levelNum: 1,
    name: 'MAXIMUM DOWNFORCE',
    description: 'Build a true high-downforce package. The rear wing must work hard, but you still need to keep drag inside a tight cap.',

    f1Init: { frontWingAngle: 8, rearWingAngle: 10, diffAngle: 6, groundClearance: 48 },

    f1Targets: {
      Cd: { min: null, max: 1.38 },
      Cl: { min: 2.70, max: null },
    },
    description2: 'Cl ≥ 2.70  |  Cd ≤ 1.38',
    thresholds: [0.66, 0.85, 0.95],
    hint: 'The rear wing does most of the work here. Add front wing only as needed, then trim ride height and diffuser to stop drag from blowing the limit.',
  },

  {
    id: '3-2',
    phase: 3, levelNum: 2,
    name: 'LOW DRAG SPRINT',
    description: 'Trim the car for a straight-line run without turning it into a skittish brick. Tiny wing changes matter here.',

    f1Init: { frontWingAngle: 20, rearWingAngle: 24, diffAngle: 11, groundClearance: 28 },

    f1Targets: {
      Cd: { min: null, max: 0.86 },
      Cl: { min: 1.76, max: null },
    },
    description2: 'Cd ≤ 0.86  |  Cl ≥ 1.76',
    thresholds: [0.68, 0.86, 0.96],
    hint: 'Peel wing out of the car carefully. Too flat and you miss the Cl floor; too much rear wing and the drag target is gone.',
  },

  {
    id: '3-3',
    phase: 3, levelNum: 3,
    name: 'THE BALANCE',
    description: 'Find the narrow setup window where the wings and underfloor balance. This one should take iteration.',

    f1Init: { frontWingAngle: 30, rearWingAngle: 32, diffAngle: 4, groundClearance: 46 },

    f1Targets: {
      Cd: { min: 1.20, max: 1.23 },
      Cl: { min: 2.38, max: 2.43 },
    },
    description2: '1.20 ≤ Cd ≤ 1.23  |  2.38 ≤ Cl ≤ 2.43',
    thresholds: [0.76, 0.90, 0.98],
    hint: 'Use the front and rear wings against each other, then trim diffuser and ride height for the final few hundredths.',
  },

];

// ── PHASE METADATA ──────────────────────────────────────────────

const PHASES = [
  {
    num:   1,
    title: 'COANDA DEFLECTION',
    desc:  'Master single-profile deflection.',
    levels: [0, 1, 2],  // indices into LEVELS array
  },
  {
    num:   2,
    title: 'DUAL ROUTING',
    desc:  'Chain two deflections together.',
    levels: [3, 4, 5],
  },
  {
    num:   3,
    title: 'F1 CONFIGURATOR',
    desc:  'Balance drag and downforce on a Formula 1 car.',
    levels: [6, 7, 8],
  },
];

// Helper: get level index for a phase + levelNum
function getLevelIndex(phase, levelNum) {
  return PHASES[phase - 1].levels[levelNum - 1];
}

// Helper: get next level index (null if last)
function getNextLevelIndex(currentIdx) {
  if (currentIdx < LEVELS.length - 1) return currentIdx + 1;
  return null;
}
