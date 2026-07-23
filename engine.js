// Deterministic implementation of solar-system-evolution-ruleset.md.
// The engine owns every hazard roll, resolution calc, and panspermia check —
// agents never see rolled severity, only the forecasted hazard TYPE (§12 fog of war).

export const TRAITS = ["THM", "RAD", "PRS", "MET", "STR", "MOB"];

export const PLANETS = [
  {
    name: "mercury",
    signature: "Airless, brutal day/night thermal swing, solar-wind blasted",
    base: { THM: 8, RAD: 6, PRS: 2, MET: 4, STR: 5, MOB: 3 },
    hazards: [
      { type: "Solar flare surge", trait: "RAD" },
      { type: "Micrometeorite storm", trait: "STR" },
      { type: "Day/night thermal shock", trait: "THM" },
      { type: "Charged dust storm", trait: "MOB" },
    ],
  },
  {
    name: "venus",
    signature: "Crushing pressure, 465°C surface, sulfuric acid clouds",
    base: { THM: 9, RAD: 3, PRS: 8, MET: 3, STR: 6, MOB: 2 },
    hazards: [
      { type: "Acid rain corrosion", trait: "STR" },
      { type: "Atmospheric crush event", trait: "PRS" },
      { type: "Volcanic outgassing", trait: "THM" },
      { type: "Superrotation windstorm", trait: "MOB" },
    ],
  },
  {
    name: "earth",
    signature: "Baseline/moderate — the control case",
    base: { THM: 5, RAD: 4, PRS: 4, MET: 5, STR: 4, MOB: 5 },
    hazards: [
      { type: "Extreme weather", trait: "STR" },
      { type: "Tectonic event", trait: "STR" },
      { type: "Glacial/interglacial swing", trait: "THM" },
      { type: "Impactor near-miss", trait: "RAD" },
    ],
  },
  {
    name: "mars",
    signature: "Thin cold atmosphere, no magnetosphere, dust, buried ice",
    base: { THM: 6, RAD: 6, PRS: 3, MET: 6, STR: 4, MOB: 4 },
    hazards: [
      { type: "Global dust storm", trait: "MOB" },
      { type: "Cosmic radiation exposure", trait: "RAD" },
      { type: "Deep-freeze night", trait: "THM" },
      { type: "Subsurface scarcity", trait: "MET" },
    ],
  },
  {
    name: "jupiter",
    signature: "No surface — aerial/cloud life, radiation belts, mega-storms",
    base: { THM: 4, RAD: 7, PRS: 7, MET: 3, STR: 6, MOB: 6 },
    hazards: [
      { type: "Radiation belt surge", trait: "RAD" },
      { type: "Mega-storm turbulence", trait: "STR" },
      { type: "Vertical pressure gradient", trait: "PRS" },
      { type: "Superstorm lightning", trait: "STR" },
    ],
  },
  {
    name: "saturn",
    signature: "Gas giant, ring debris, high windshear, milder radiation than Jupiter",
    base: { THM: 5, RAD: 5, PRS: 6, MET: 4, STR: 5, MOB: 5 },
    hazards: [
      { type: "Ring debris bombardment", trait: "STR" },
      { type: "High-altitude windshear", trait: "MOB" },
      { type: "Hexagon storm cycle", trait: "PRS" },
      { type: "Magnetic field flux", trait: "RAD" },
    ],
  },
  {
    name: "uranus",
    signature: "Ice giant, extreme 42-year seasons from its sideways tilt, deep cold",
    base: { THM: 7, RAD: 4, PRS: 6, MET: 5, STR: 4, MOB: 3 },
    hazards: [
      { type: "Extreme season transition", trait: "THM" },
      { type: "Methane ice crystallization", trait: "PRS" },
      { type: "Deep atmospheric pressure", trait: "PRS" },
      { type: "Tilted-magnetosphere anomaly", trait: "RAD" },
    ],
  },
  {
    name: "neptune",
    signature: "Ice giant, fastest winds in the system, starved for solar energy",
    base: { THM: 8, RAD: 4, PRS: 6, MET: 7, STR: 5, MOB: 3 },
    hazards: [
      { type: "Supersonic windstorm", trait: "MOB" },
      { type: "Deep-cold energy scarcity", trait: "MET" },
      { type: "Storm formation/collapse", trait: "STR" },
      { type: "Faint-sun energy scarcity", trait: "MET" },
    ],
  },
];

// Tunable — ruleset leaves the severity distribution unspecified.
const SEVERITY_TABLE = [
  { label: "Low", weight: 0.4, mult: 1 },
  { label: "Medium", weight: 0.3, mult: 2 },
  { label: "High", weight: 0.2, mult: 3 },
  { label: "Extreme", weight: 0.1, mult: 5 },
];
const IMPACT_HAZARD_MARKERS = ["meteor", "impact", "debris", "bombardment"];

const MIGRATE_COST = 2;
const RAID_COST = 3; // AP cost to raid a rival planet this epoch
const DOMINION_TARGET = 12000; // display anchor for the shared fleet-wide goal — not a win condition

// Prestige tiers — the escalating "prove what lifeform is greatest" payoff. Checked every
// epoch against current POP (not a one-time crossing), highest tier first, one promotion per
// epoch. Tier is a permanent rank (never revoked by a later POP dip) and multiplies effective
// trait strength everywhere combat/hazard math reads a trait — an Uber Minion is just flatly
// stronger, in defense and in a raid ("consume", once tiered).
const TIER_NAMES = ["", "Uber Minion", "Uber Uber Minion"];
const TIER_THRESHOLDS = [2500, 6000]; // POP required to be eligible for tier 1, tier 2
const TIER_MULT = [1, 1.6, 3];
const COLONIZER_SHARE = 0.5; // fleet-POP share needed, at max tier, to be declared the dominant lifeform

function weightedPick(table) {
  const r = Math.random();
  let acc = 0;
  for (const row of table) {
    acc += row.weight;
    if (r <= acc) return row;
  }
  return table[table.length - 1];
}

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

function traitBreadth(traits) {
  const vals = TRAITS.map((t) => traits[t]);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  if (max <= 0) return 0;
  return Math.max(0, min / max); // 1 = perfectly even spread, low if one stat dominates
}

export class SolarSystemEngine {
  constructor() {
    this.epochNumber = 0;
    this.log = [];
    this.agents = new Map(
      PLANETS.map((p) => [
        p.name,
        {
          name: p.name,
          signature: p.signature,
          hazards: p.hazards,
          traits: { ...p.base },
          POP: 1000,
          carriedAP: 0,
          survivalStreak: 0,
          bottleneckEpochsLeft: 0,
          colonizationScore: 0,
          extinct: false,
          tier: 0,
          invasiveClones: [], // { sourcePlanet, pop, traits }
        },
      ])
    );
    this.lastPromoted = null; // fairness rotation — see _checkPromotion()
  }

  epochMultiplier(epochNumber = this.epochNumber) {
    return 1 + epochNumber / 20;
  }

  availableAP(agent) {
    return Math.floor(agent.POP / 100) + agent.traits.MET + agent.carriedAP;
  }

  /** §1-§2 Epoch Setup + Hazard Roll. Returns the fog-of-war forecast (type only, no severity). */
  beginEpoch() {
    this.epochNumber += 1;
    const multiplier = this.epochMultiplier();
    const rolls = new Map();
    const forecasts = {};
    const apAvailable = {};

    for (const agent of this.agents.values()) {
      if (agent.extinct) continue;
      const hazard = agent.hazards[Math.floor(Math.random() * agent.hazards.length)];
      const severity = weightedPick(SEVERITY_TABLE);
      rolls.set(agent.name, { hazard, severity });
      forecasts[agent.name] = { hazardType: hazard.type, defendingTrait: hazard.trait };
      apAvailable[agent.name] = this.availableAP(agent);
    }

    this._pendingRolls = rolls;
    return {
      epochNumber: this.epochNumber,
      multiplier,
      forecasts,
      apAvailable,
      leaderboard: this.leaderboard(),
      dominion: this.dominion(),
    };
  }

  /** Gru's shared fleet-wide goal — the cooperative half of the dual objective (§ competition addendum). */
  dominion() {
    const total = round2([...this.agents.values()].reduce((s, a) => s + a.POP, 0));
    const alive = [...this.agents.values()].filter((a) => !a.extinct);
    const leader = alive.reduce((best, a) => (!best || a.POP > best.POP ? a : best), null);
    const leaderShare = leader && total > 0 ? leader.POP / total : 0;
    // The colonization payoff: one lifeform, at the top tier, holding most of the fleet's
    // population, proving itself the greatest and set to colonize the universe.
    const colonizer =
      leader && leader.tier >= TIER_THRESHOLDS.length && leaderShare >= COLONIZER_SHARE ? leader.name : null;
    return {
      total,
      target: DOMINION_TARGET,
      pct: round2(clamp01(total / DOMINION_TARGET)),
      colonizer,
      colonizerShare: colonizer ? round2(leaderShare) : 0,
    };
  }

  /**
   * Checked every epoch against current POP (not a one-time crossing). Highest tier first,
   * at most one promotion per epoch. Fairness: skip whoever was promoted last if anyone else
   * qualifies, so the crown rotates instead of pinning to one lineage — others get their own
   * shot before the strongest inevitably starts consuming them.
   */
  _checkPromotion() {
    for (let tier = TIER_THRESHOLDS.length; tier >= 1; tier--) {
      const threshold = TIER_THRESHOLDS[tier - 1];
      // Sequential rank: must hold tier-1 exactly (not just "any lower tier") to be promoted —
      // a POP spike can't vault a planet straight to Uber Uber without holding Uber first.
      const eligible = [...this.agents.values()]
        .filter((a) => !a.extinct && a.tier === tier - 1 && a.POP >= threshold)
        .sort((a, b) => b.POP - a.POP);
      if (!eligible.length) continue;
      const chosen = eligible.find((a) => a.name !== this.lastPromoted) || eligible[0];
      chosen.tier = tier;
      this.lastPromoted = chosen.name;
      return { planet: chosen.name, tier, tierName: TIER_NAMES[tier], pop: round2(chosen.POP) };
    }
    return null;
  }

  /** Safety-gate: never trust the LLM's arithmetic. Clamp to a legal action inside the AP budget. */
  sanitizeAction(agent, rawAction, apBudget) {
    const warnings = [];
    const invest = {};
    let raw = rawAction && typeof rawAction === "object" ? rawAction : {};
    const rawInvest = raw.invest && typeof raw.invest === "object" ? raw.invest : {};

    for (const t of TRAITS) {
      let v = Number(rawInvest[t]);
      if (!Number.isFinite(v) || v < 0) v = 0;
      invest[t] = v;
    }
    let reproduce = Number(raw.reproduce);
    if (!Number.isFinite(reproduce) || reproduce < 0) reproduce = 0;
    let migrate = raw.migrate === true;
    const dormancy = raw.dormancy === true;

    let raidTarget = null;
    if (raw.raid && typeof raw.raid === "object" && typeof raw.raid.target === "string") {
      const t = raw.raid.target.toLowerCase().trim();
      const targetAgent = this.agents.get(t);
      if (targetAgent && t !== agent.name && !targetAgent.extinct) raidTarget = t;
    }

    const migrateCost = migrate ? MIGRATE_COST : 0;
    let raidCost = raidTarget ? RAID_COST : 0;
    let total = TRAITS.reduce((s, t) => s + invest[t], 0) + reproduce + migrateCost + raidCost;

    if (total > apBudget) {
      warnings.push(`action requested ${total} AP but only ${apBudget} available — scaled down`);
      const flatCost = migrateCost + raidCost;
      const variableBudget = Math.max(0, apBudget - flatCost);
      const variableTotal = TRAITS.reduce((s, t) => s + invest[t], 0) + reproduce;
      const scale = variableTotal > 0 ? variableBudget / variableTotal : 0;
      for (const t of TRAITS) invest[t] = Math.floor(invest[t] * scale);
      reproduce = Math.floor(reproduce * scale);
      total = TRAITS.reduce((s, t) => s + invest[t], 0) + reproduce + flatCost;
      // flat costs alone can still bust the budget after scaling variable spend to zero —
      // drop the raid first (the competitive extra), then migrate, to get back in budget.
      if (total > apBudget && raidTarget) {
        warnings.push("dropped raid — budget too tight after scaling");
        raidTarget = null;
        total -= raidCost;
        raidCost = 0;
      }
      if (total > apBudget && migrate) {
        warnings.push("dropped migrate — budget too tight after scaling");
        migrate = false;
      }
    }

    return {
      invest,
      reproduce,
      migrate,
      dormancy,
      raidTarget,
      spentAP: TRAITS.reduce((s, t) => s + invest[t], 0) + reproduce + (migrate ? MIGRATE_COST : 0) + (raidTarget ? RAID_COST : 0),
      warnings,
    };
  }

  /** §3-§6 Decision + Resolution + Scoring + Rare Contact, plus raid competition. */
  resolveEpoch(actionsByPlanet) {
    const multiplier = this.epochMultiplier();
    const results = {};

    // Sanitize every action up front — no mutation yet — so raid resolution reads a
    // consistent pre-epoch snapshot regardless of Map iteration order (mutual raids
    // between two planets in the same epoch must not depend on who resolves first).
    const sanitized = new Map();
    for (const agent of this.agents.values()) {
      if (agent.extinct) continue;
      const apBudget = this.availableAP(agent);
      sanitized.set(agent.name, { apBudget, action: this.sanitizeAction(agent, actionsByPlanet[agent.name], apBudget) });
    }

    // Tier multiplies effective STR/MOB for combat — an Uber Minion hits harder AND is
    // tougher to raid (a raid by a tiered attacker is framed as a "consume").
    const preEpochOffense = new Map(
      [...this.agents.entries()].map(([name, a]) => [name, ((a.traits.STR + a.traits.MOB) / 2) * TIER_MULT[a.tier]])
    );
    const preEpochDefense = new Map(
      [...this.agents.entries()].map(([name, a]) => [name, a.traits.STR * TIER_MULT[a.tier]])
    );

    const raids = [];
    for (const [name, { action }] of sanitized.entries()) {
      if (!action.raidTarget) continue;
      const attacker = this.agents.get(name);
      const defender = this.agents.get(action.raidTarget);
      if (!defender || defender.extinct) continue;
      const offense = preEpochOffense.get(name);
      const defense = preEpochDefense.get(action.raidTarget);
      const edge = offense - defense; // can be negative — a weak raid can whiff entirely
      const stolenFrac = clamp01(0.05 + edge * 0.02);
      const stolen = round2(defender.POP * stolenFrac);
      defender.POP = Math.max(0, defender.POP - stolen);
      attacker.POP += stolen;
      raids.push({
        attacker: name,
        defender: action.raidTarget,
        stolen,
        success: stolen > 0,
        consume: attacker.tier > 0, // an Uber Minion doesn't raid, it consumes
      });
    }

    for (const agent of this.agents.values()) {
      if (agent.extinct) continue;
      const roll = this._pendingRolls.get(agent.name);
      const { apBudget, action } = sanitized.get(agent.name);

      // Decision phase: apply training investment + reproduction immediately.
      for (const t of TRAITS) {
        if (action.invest[t] > 0) agent.traits[t] += action.invest[t] / 3;
      }
      if (action.reproduce > 0) agent.POP += action.reproduce * 5;

      // Resolution phase.
      const { hazard, severity } = roll;
      let effectiveTraitValue = agent.traits[hazard.trait] * TIER_MULT[agent.tier];
      if (agent.bottleneckEpochsLeft > 0) effectiveTraitValue *= 0.5;
      const effectiveDefense = effectiveTraitValue + (action.migrate ? MIGRATE_COST : 0);
      const hazardScore = severity.mult * multiplier;
      const outcome = effectiveDefense - hazardScore;

      let popDelta = 0;
      let reinforced = false;
      if (outcome >= 0) {
        popDelta = outcome * 5;
        if (action.invest[hazard.trait] > 0) {
          agent.traits[hazard.trait] += 1;
          reinforced = true;
        }
        agent.survivalStreak += 1;
      } else {
        popDelta = -Math.abs(outcome) * 10;
        agent.survivalStreak = 0;
      }
      agent.POP = Math.max(0, agent.POP + popDelta);

      // Dormancy: unspent AP carries at 50% value; otherwise lost.
      const unspent = Math.max(0, apBudget - action.spentAP);
      agent.carriedAP = action.dormancy ? Math.floor(unspent * 0.5) : 0;

      let bottleneckTriggered = false;
      if (agent.POP > 0 && agent.POP <= 250 && agent.bottleneckEpochsLeft <= 0) {
        agent.bottleneckEpochsLeft = 3;
        bottleneckTriggered = true;
      }
      if (agent.bottleneckEpochsLeft > 0) agent.bottleneckEpochsLeft -= 1;

      let extinct = false;
      if (agent.POP <= 0) {
        agent.POP = 0;
        agent.extinct = true;
        extinct = true;
      }

      results[agent.name] = {
        hazardType: hazard.type,
        defendingTrait: hazard.trait,
        severity: severity.label,
        hazardScore: round2(hazardScore),
        effectiveDefense: round2(effectiveDefense),
        outcome: round2(outcome),
        popDelta: round2(popDelta),
        pop: round2(agent.POP),
        traits: roundTraits(agent.traits),
        tier: agent.tier,
        reinforced,
        bottleneckTriggered,
        bottleneckActive: agent.bottleneckEpochsLeft > 0,
        extinct,
        action,
      };
    }

    const panspermia = this._rollPanspermia();
    this._settleInvasiveClones();
    const promotion = this._checkPromotion();
    const leaderboard = this.leaderboard();

    return {
      epochNumber: this.epochNumber,
      multiplier: round2(multiplier),
      results,
      panspermia,
      raids,
      promotion,
      leaderboard,
      dominion: this.dominion(),
    };
  }

  _rollPanspermia() {
    const alive = [...this.agents.values()].filter((a) => !a.extinct && a.POP > 0);
    if (alive.length < 2) return null;

    let triggered = Math.random() < 0.05;
    let forced = false;
    for (const [planet, roll] of this._pendingRolls.entries()) {
      if (
        roll.severity.label === "Extreme" &&
        IMPACT_HAZARD_MARKERS.some((m) => roll.hazard.type.toLowerCase().includes(m))
      ) {
        triggered = true;
        forced = true;
      }
    }
    if (!triggered) return null;

    const source = alive[Math.floor(Math.random() * alive.length)];
    const candidates = alive.filter((a) => a.name !== source.name);
    const dest = candidates[Math.floor(Math.random() * candidates.length)];
    const fragmentPop = source.POP * 0.01;
    if (fragmentPop < 1) return null;

    source.POP -= fragmentPop;
    let revived = false;
    if (dest.extinct) {
      dest.extinct = false;
      dest.POP = fragmentPop * 0.5;
      dest.traits = scaleTraits(source.traits, 0.5);
      dest.tier = 0; // a revived lineage restarts from the bottom, even if it died as an Uber
      revived = true;
    } else {
      dest.invasiveClones.push({ sourcePlanet: source.name, pop: fragmentPop, traits: { ...source.traits } });
    }

    return {
      forced,
      source: source.name,
      destination: dest.name,
      fragmentPop: round2(fragmentPop),
      revived,
    };
  }

  _settleInvasiveClones() {
    for (const agent of this.agents.values()) {
      if (agent.invasiveClones.length === 0) continue;
      const survivors = [];
      for (const clone of agent.invasiveClones) {
        clone.pop *= 0.85 + Math.random() * 0.1; // poorly matched to a new environment — drifts down
        if (clone.pop >= 1) survivors.push(clone);
      }
      agent.invasiveClones = survivors;
      const dominantClone = survivors.find((c) => c.pop > agent.POP);
      if (dominantClone) {
        agent.contestedNiche = true;
        const source = this.agents.get(dominantClone.sourcePlanet);
        if (source) source.colonizationScore = Math.min(1, source.colonizationScore + 0.05);
      } else {
        agent.contestedNiche = false;
      }
    }
  }

  leaderboard() {
    const alive = [...this.agents.values()].filter((a) => !a.extinct);
    const maxPOP = Math.max(1, ...alive.map((a) => a.POP));
    const rows = [...this.agents.values()].map((agent) => {
      const normalizedPOP = agent.extinct ? 0 : agent.POP / maxPOP;
      const breadth = traitBreadth(agent.traits);
      const streakScore = Math.min(1, agent.survivalStreak / 20);
      const cai =
        0.4 * normalizedPOP + 0.2 * breadth + 0.2 * streakScore + 0.2 * (agent.colonizationScore || 0);
      return {
        planet: agent.name,
        pop: round2(agent.POP),
        cai: round2(cai),
        survivalStreak: agent.survivalStreak,
        extinct: agent.extinct,
        bottleneckActive: agent.bottleneckEpochsLeft > 0,
        contestedNiche: !!agent.contestedNiche,
        tier: agent.tier,
        tierName: TIER_NAMES[agent.tier],
      };
    });
    rows.sort((a, b) => b.cai - a.cai);
    return rows;
  }

  snapshot() {
    return {
      epochNumber: this.epochNumber,
      agents: Object.fromEntries(
        [...this.agents.entries()].map(([name, a]) => [
          name,
          { ...a, traits: roundTraits(a.traits) },
        ])
      ),
      leaderboard: this.leaderboard(),
      dominion: this.dominion(),
    };
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
function roundTraits(traits) {
  return Object.fromEntries(TRAITS.map((t) => [t, round2(traits[t])]));
}
function scaleTraits(traits, factor) {
  return Object.fromEntries(TRAITS.map((t) => [t, traits[t] * factor]));
}
