# AERO//BLOCKS

> **Aerodynamic Puzzle Trainer — Wind Tunnel Division**
> *Master the Coanda Effect to progress.*

[![Play Now](https://img.shields.io/badge/▶%20PLAY-GitHub%20Pages-00F0FF?style=for-the-badge&logo=github)](https://pablocastilla.github.io/aero_blocks/)
[![License: MIT](https://img.shields.io/badge/License-MIT-FF525C?style=for-the-badge)](LICENSE)

---

## What is AERO//BLOCKS?

**AERO//BLOCKS** is a browser-based puzzle game that fuses the block-placement mechanics of **Tetris** with the physics of a **wind tunnel simulation**. Instead of stacking blocks to clear lines, you position aerodynamic deflector profiles inside a simulated airflow channel to guide a stream of particles toward a target zone.

The twist: the airflow doesn't just bounce off your deflectors — it *clings* to them, curves around them, and follows their contours. That behaviour is the **Coanda effect**, and mastering it is the entire game.

---

## The Coanda Effect

The **Coanda effect** is a fascinating aerodynamic phenomenon first described by Romanian engineer **Henri Coandă** in the early 20th century.

### The Principle

> **A fluid jet (air or liquid) tends to adhere to and follow the surface of a nearby curved or flat object, rather than travelling in a straight line.**

When a fast-moving stream of air encounters a curved surface, a low-pressure region forms between the jet and the surface. Atmospheric pressure on the other side pushes the jet toward the surface, causing it to "stick" and curve along it — sometimes dramatically changing its direction.

### Real-World Applications

The Coanda effect is not just a curiosity — it is fundamental to modern engineering:

| Domain | Application |
|--------|-------------|
| ✈️ **Aviation** | Wing flap systems that redirect engine thrust to increase lift at low speeds |
| 🏎️ **Formula 1** | Complex front wing geometry that routes airflow to cool brakes and generate downforce |
| 🌬️ **HVAC** | Ceiling-mounted air diffusers that spread airflow across a room without draughts |
| 🩺 **Medicine** | Fluidic logic in ventilator circuits with no moving parts |
| 💨 **Jet engines** | High-bypass turbofans use shaped nacelles to keep exhaust attached longer |

### In AERO//BLOCKS

In the game, a continuous stream of particles enters from the **left side** of the wind tunnel. Your job is to place and orient **aerofoil-shaped deflectors** (your "blocks") so that the airflow clings to their curved surfaces and is routed toward the **target capture zone**.

- A particle stream aimed at a flat wall just bounces.
- A particle stream aimed at a curved deflector *follows the curve* — the Coanda effect at work.
- Chain deflections together to route flow through tight paths and score maximum stars.

---

## Game Phases

| Phase | Name | Description |
|-------|------|-------------|
| **01** | Coanda Deflection | Place a single deflector to guide the airflow to the target zone. |
| **02** | Dual Routing | Chain two deflectors to route the stream through complex paths. |
| **03** | F1 Configurator | Engineer a virtual F1 car — balance drag coefficient (Cd) and downforce (Cl) to hit precise aerodynamic targets. |

---

## Controls

| Action | Keyboard | Mobile |
|--------|----------|--------|
| Move deflector | `Arrow Keys` | Drag |
| Rotate deflector | `R` | Toggle `↔ MOVE` button |
| Submit solution | `Enter` | `SUBMIT` button |
| Abort mission | `Esc` | `✕ ABORT` button |
| Debug panel | `D` | — |

---

## Tech Stack

This is a **pure vanilla web game** — no frameworks, no build tools, no dependencies beyond Google Fonts.

```
index.html      — Game shell & screens
styles.css      — Full design system (cyberpunk / CRT aesthetic)
js/
  profiles.js   — Aerofoil shape definitions
  physics.js    — Particle simulation & Coanda flow model
  renderer.js   — Canvas 2D rendering engine
  input.js      — Keyboard & touch input handling
  levels.js     — Level & mission definitions
  hud.js        — HUD, screens & UI state machine
  main.js       — Game loop & orchestration
```

---

## Running Locally

No installation required. Just open `index.html` in a modern browser, or serve it with any static file server:

```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```

Then navigate to `http://localhost:8080`.

---

## Design System

The visual identity follows a **Neon Kineticist / Cyberpunk CRT** aesthetic — inspired by classified military aeronautics programs and high-end data visualisation terminals. See [DESIGN.md](DESIGN.md) for the full design specification.

**Fonts:** Bungee · Space Grotesk · Share Tech Mono
**Palette:** Deep Void `#0e0e14` · Cyan `#00F0FF` · Magenta `#FF525C` · Amber `#ffb77f`

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first.

---

*Clearance Level: TS/SCI — Operator: CLASSIFIED — Session: 2099*
