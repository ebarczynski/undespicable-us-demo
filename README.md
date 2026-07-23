# Gru's Minion Swarm — Intergalactic Command

**One-page project summary (architecture, parallelism proof, cost breakdown):** [`docs/index.html`](docs/index.html) — open directly, or once GitHub Pages is enabled (Settings → Pages → source: `main` branch, `/docs` folder), it's live at `https://ebarczynski.github.io/undespicable-us-demo/`.

A visual multi-agent simulation of `solar-system-evolution-ruleset.md`. Gru (coordinator)
commands from his flagship; one Minion pilot-agent per planet reports back each epoch.
Underneath the theme, it's a real Claude-powered swarm: Gru delegates to all 8 living
planet-garrisons in a **single message** (parallel `tool_use` fan-out), and each Minion is an
independent Haiku call deciding its epoch action under fog-of-war (hazard type known, severity
hidden).

Each Minion has a **dual objective**: climb the individual leaderboard (Cosmic Adaptation
Index) AND grow Gru's shared Dominion meter (the fleet's combined population). They can also
**raid** a named rival for 3 AP — offense (STR+MOB) vs. the target's defense (STR) decides
whether population actually transfers. This is genuine emergent behavior, not scripted: in
testing, agents independently chose real targets, occasionally raided the same rival at once
(resolved order-independently against a pre-epoch snapshot), and their in-character battle
cries lined up with what they'd actually decided.

## Run it

```
npm install        # already done if you're reading this after setup
npm start          # -> http://localhost:4173
```

Open the URL, then:
- **▶ START** — auto-runs epochs continuously
- **⏭ STEP** — advance exactly one epoch
- **⏩ SPEED** — cycle 1×/2×/4×, shortens the pause between epochs. Claude API latency
  (coordinator + parallel specialists, ~2-5s/epoch) is the real floor either way — speed
  mostly cuts the idle gap, not the agent calls themselves.
- **⟲ RESET** — fresh run, all planets back to POP 1000

The simulation keeps running server-side even while you're in Fun Mode.

## Fun Mode

Type **G**, **R**, **U** in sequence anywhere on the page to scramble a fighter into an
Asteroids-style dodge game: steer with arrows/WASD, fire with Space, dodge Gru's telegraphed
wrath-ray sweeps, shoot asteroids for score. Same combo (or Escape) returns to Command view.

## Verifying it actually works (not just "looks nice")

```
npm run test:fanout      # proves Gru emits all tool_use blocks in ONE message, and that
                         # specialist calls genuinely overlap in wall-clock time (not serialized)
npm run test:epoch       # one full epoch through the real engine + real Claude calls — prints
                         # any raids that happened and the Dominion meter before/after
npm run test:reset-race  # reproduces the RESET-mid-epoch race that used to crash the server
npm run eval             # deployment-gate style eval harness on the untrusted-action safety gate
```

`npm run eval` is the one to run after touching `engine.js` or `agents.js` — it's a
regression suite, not a one-off check.

## Architecture notes

- **engine.js** — deterministic ruleset (hazard rolls, resolution formula, CAI leaderboard,
  bottleneck/extinction/panspermia, raids, Dominion meter). Owns every roll; agents never see
  rolled severity. Raids resolve against a pre-epoch snapshot of STR/MOB, so two planets
  raiding each other (or the same target) in one epoch don't depend on iteration order.
- **agents.js** — Gru (coordinator, Haiku) + 8 Minion specialists (Haiku). Both sides use
  forced tool-calling (`tool_choice`) so outputs are always structured, never free-text.
  Specialists see the full rival roster (POP/CAI) and the Dominion meter each epoch, and are
  prompted with the dual objective explicitly. The specialist system prompt is cached
  (`cache_control: ephemeral`) since it's identical across all 8 calls and every epoch —
  though it's short enough that the real win here is mostly illustrative; a bigger shared
  context would show a real cost/latency delta.
- **server.js** — Express + WebSocket. Streams every phase (forecast → dispatch → each
  specialist's start/done → resolution) live, with real timestamps, so the fan-out is
  visibly simultaneous rather than reconstructed after the fact. Speed control only changes
  the pause between epochs (`SPEED_LEVELS`), not the Claude calls.
- **public/js/sim.js** — canvas renderer for the space scene (Gru's flagship, Minion ships,
  raid duels, Dominion meter). The nebula background is a real image (`public/assets/nebula-bg.png`)
  behind a transparent canvas, not hand-drawn gradients.
- **public/js/funmode.js** — the Asteroids minigame, fully client-side.
- Model tier: Haiku throughout (simple structured routing/extraction, not final-quality
  creative output) — see `fde-inference-tuner` decision rule.
