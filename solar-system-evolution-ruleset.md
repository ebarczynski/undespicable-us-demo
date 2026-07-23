# Solar System Evolution — Simulation Ruleset v1

**Premise:** Eight lifeforms, one per planet, each hardened by its own world. They almost never meet. The competition is indirect — every agent is racing the clock against its own environment, and they're only ranked against each other on a shared scoreboard. Real contact is rare, accidental, and dangerous when it happens.

---

## 1. Entities

Each planet is one agent controlling one lifeform. Suggested roster (the 8 planets; moons/dwarf planets are a clean expansion path, noted at the end).

| Planet | Environmental Signature |
|---|---|
| Mercury | Airless, brutal day/night thermal swing, solar-wind blasted |
| Venus | Crushing pressure, 465°C surface, sulfuric acid clouds |
| Earth | Baseline/moderate — the control case |
| Mars | Thin cold atmosphere, no magnetosphere, dust, buried ice |
| Jupiter | No surface — aerial/cloud life, radiation belts, mega-storms |
| Saturn | Gas giant, ring debris, high windshear, milder radiation than Jupiter |
| Uranus | Ice giant, extreme 42-year seasons from its sideways tilt, deep cold |
| Neptune | Ice giant, fastest winds in the system, starved for solar energy |

---

## 2. Core Stats

Each lifeform has six adaptive traits (1–10 scale, no hard cap on growth) plus two resource pools.

- **THM** — Thermal Tolerance
- **RAD** — Radiation Resistance
- **PRS** — Pressure Tolerance
- **MET** — Metabolic Efficiency (resists resource scarcity)
- **STR** — Structural Resilience (impacts, storms, physical trauma)
- **MOB** — Mobility / Adaptive Response (relocation, evasion)

**POP** (Population/Biomass) — the health pool. Starts at 1000. Hits 0 → extinct.
**AP** (Adaptation Points) — spent each turn. Generated per epoch as `AP = floor(POP / 100) + MET`.

### Suggested starting profiles (defaults — tune freely)

| Planet | THM | RAD | PRS | MET | STR | MOB |
|---|---|---|---|---|---|---|
| Mercury | 8 | 6 | 2 | 4 | 5 | 3 |
| Venus | 9 | 3 | 8 | 3 | 6 | 2 |
| Earth | 5 | 4 | 4 | 5 | 4 | 5 |
| Mars | 6 | 6 | 3 | 6 | 4 | 4 |
| Jupiter | 4 | 7 | 7 | 3 | 6 | 6 |
| Saturn | 5 | 5 | 6 | 4 | 5 | 5 |
| Uranus | 7 | 4 | 6 | 5 | 4 | 3 |
| Neptune | 8 | 4 | 6 | 7 | 5 | 3 |

---

## 3. Hazard Tables (per planet, one rolled per epoch)

Each planet has four hazard types tied to specific traits. Severity is rolled independently: **Low (1×) / Medium (2×) / High (3×) / Extreme (5×)**, then scaled by the global Epoch Multiplier (see §5).

| Planet | Hazards (→ defending trait) |
|---|---|
| Mercury | Solar flare surge (RAD) · Micrometeorite storm (STR) · Day/night thermal shock (THM) · Charged dust storm (MOB) |
| Venus | Acid rain corrosion (STR) · Atmospheric crush event (PRS) · Volcanic outgassing (THM) · Superrotation windstorm (MOB) |
| Earth | Extreme weather (STR) · Tectonic event (STR) · Glacial/interglacial swing (THM) · Impactor near-miss (RAD) |
| Mars | Global dust storm (MOB) · Cosmic radiation exposure (RAD) · Deep-freeze night (THM) · Subsurface scarcity (MET) |
| Jupiter | Radiation belt surge (RAD) · Mega-storm turbulence (STR) · Vertical pressure gradient (PRS) · Superstorm lightning (STR) |
| Saturn | Ring debris bombardment (STR) · High-altitude windshear (MOB) · Hexagon storm cycle (PRS) · Magnetic field flux (RAD) |
| Uranus | Extreme season transition (THM) · Methane ice crystallization (PRS) · Deep atmospheric pressure (PRS) · Tilted-magnetosphere anomaly (RAD) |
| Neptune | Supersonic windstorm (MOB) · Deep-cold energy scarcity (MET) · Storm formation/collapse (STR) · Faint-sun energy scarcity (MET) |

**Fog of war:** agents are told *which hazard* is forecast for their planet this epoch, but not its rolled severity — only that it's coming. This forces real risk allocation instead of solving for a known number.

---

## 4. Turn Loop (one Epoch = one "turn")

1. **Epoch Setup** — engine advances the Epoch Multiplier (§5).
2. **Hazard Roll** — one hazard + severity rolled per planet (severity hidden from the agent).
3. **Decision Phase** — each agent submits an action (schema in §6) allocating its AP.
4. **Resolution Phase** — engine reveals severity and resolves outcome (formula in §7).
5. **Scoring Phase** — Cosmic Adaptation Index (CAI) updated, leaderboard re-ranked.
6. **Rare Contact Check** — small chance of a cross-planet event (§8).

---

## 5. Epoch Multiplier (difficulty curve)

`multiplier = 1 + (epoch_number / 20)` — a soft ramp representing the system aging (solar luminosity drift, accumulating cosmic wear). Keeps the sim from stalling into equilibrium; late epochs are meaningfully harder than early ones.

---

## 6. Agent Action Schema (submitted each epoch)

```json
{
  "planet": "mars",
  "invest": { "THM": 0, "RAD": 2, "PRS": 0, "MET": 1, "STR": 0, "MOB": 1 },
  "reproduce": 0,
  "migrate": false,
  "dormancy": false
}
```

- `invest` values must sum to ≤ available AP.
- `reproduce`: AP spent directly converts to POP (1 AP → 5 POP, tunable).
- `migrate`: spends 2 AP, adds a flat +2 to MOB for this epoch's resolution only (dodges localized exposure).
- `dormancy`: unspent AP carries to next epoch at 50% value instead of being lost — a bet-hedging option under uncertainty.

---

## 7. Resolution Formula

```
effective_defense = relevant_trait + (migrate ? 2 : 0)
hazard_score      = base_severity × epoch_multiplier
outcome           = effective_defense − hazard_score

if outcome >= 0:
    POP += (outcome × 5)                     # thriving off a well-matched adaptation
    relevant_trait += 1 (if this trait was invested in this epoch — reinforced selection)
else:
    POP -= (abs(outcome) × 10)
    if POP <= 250:  trigger "Bottleneck" (see below)
    if POP <= 0:    extinction
```

**Bottleneck:** POP below 250 halves all trait scores for 3 epochs (genetic bottleneck), representing a near-wipeout population re-establishing itself. Survivable, but painful — a good tension point.

---

## 8. Rare Contact — Panspermia Events

Each epoch, ~5% chance (or triggered by an "Extreme" impact-type hazard) of a transfer event:

- Engine picks a random source and destination planet.
- A fragment (1% of source POP, carrying source's trait profile) lands on the destination.
- This creates an **invasive clone** on the destination planet — an NPC using the source's stats, poorly matched to the new environment, competing for a shared regional POP cap with the native agent.
- If the invasive clone's local POP ever exceeds the native's, the native must divert extra AP toward a "contested niche" penalty until it reclaims dominance.
- This is the *only* place direct, head-to-head competition happens — everywhere else, agents are racing the environment, not each other.

---

## 9. Cosmic Adaptation Index (the leaderboard)

```
CAI = 0.4 × normalized(POP)
    + 0.2 × trait_breadth (spread across all 6 stats, not just 1–2 maxed)
    + 0.2 × survival_streak (consecutive epochs without extinction/bottleneck)
    + 0.2 × colonization_score (successful invasive footholds via §8)
```

Ranked every epoch. This is the actual "competitive" surface of the game — it's what the agents are optimizing for even though they rarely interact.

---

## 10. End Conditions

- **Horizon run:** play a fixed N epochs (e.g. 100, representing a geological span); highest CAI at the end wins "Dominant Lineage."
- **Extinction:** POP hits 0 → agent benched, kept on the scoreboard as a Fossil Record entry. Optional revival: a future panspermia event landing on that planet can reseed it at reduced stats — a narratively satisfying long-shot comeback.
- **Ascension (optional twist victory):** an agent sustains an invasive foothold as the *dominant* population on a second body for 10+ consecutive epochs → "Interplanetary Lineage" bonus win condition, layered lightly on top of the isolation-based core loop.

---

## 11. Expansion hooks (not required, but cheap to add later)

- Moons as secondary agents (Europa/Enceladus sub-ice oceans, Titan's methane lakes, Io's volcanism) — each would need its own hazard table but reuses the same stat/turn engine.
- A wildcard "technological" agent (Earth-originated probes/terraforming) that can *deliberately* trigger panspermia events instead of waiting on the 5% roll — turns one lineage into an active disruptor.
- Multiple lifeforms per planet competing for the same regional POP cap, to add local competition without touching the interplanetary structure.

---

## 12. Implementation note (for the agent swarm itself)

Each planet's agent needs, per epoch: its current state block (stats, POP, AP, streaks) + the forecasted hazard type (not severity) + current leaderboard position. It returns exactly the JSON action in §6. The engine (not the agents) owns hazard rolls, resolution math, and panspermia checks — keeps agents from being able to "see" or influence outcomes they shouldn't.
