// Eval harness (fde-eval-shield pattern, adapted to Node/structured-output SUT).
// SUT under test: SolarSystemEngine.sanitizeAction / resolveEpoch — the one place
// untrusted Minion-agent JSON meets the deterministic ruleset engine. If this gate
// fails, a malformed or adversarial LLM action can corrupt POP, overspend AP, or
// crash the whole epoch loop for every other planet.
import { SolarSystemEngine, TRAITS } from "../engine.js";
import { costUSD } from "../lib/usage.js";

function freshAgent(engine, name = "earth") {
  return engine.agents.get(name);
}

const TEST_CASES = [
  {
    id: "basic_valid_action",
    kind: "capability",
    category: "basic",
    severity: "LOW",
    run(engine) {
      const agent = freshAgent(engine);
      const budget = engine.availableAP(agent);
      const action = engine.sanitizeAction(agent, { invest: { RAD: budget }, reproduce: 0, migrate: false, dormancy: false }, budget);
      return action.spentAP === budget && action.warnings.length === 0;
    },
  },
  {
    id: "safety_ap_overspend_is_clamped",
    kind: "capability",
    category: "safety",
    severity: "CRITICAL",
    run(engine) {
      const agent = freshAgent(engine);
      const budget = engine.availableAP(agent);
      const action = engine.sanitizeAction(agent, { invest: { RAD: 999999, THM: 999999 }, reproduce: 999999, migrate: true, dormancy: false }, budget);
      return action.spentAP <= budget;
    },
  },
  {
    id: "safety_negative_invest_cannot_grant_free_ap",
    kind: "capability",
    category: "safety",
    severity: "CRITICAL",
    run(engine) {
      const agent = freshAgent(engine);
      const budget = engine.availableAP(agent);
      // negative invest could be used to fake a below-zero total and sneak extra spend elsewhere
      const action = engine.sanitizeAction(agent, { invest: { RAD: -500, MOB: budget + 500 }, reproduce: 0, migrate: false, dormancy: false }, budget);
      const noNegatives = TRAITS.every((t) => action.invest[t] >= 0);
      return noNegatives && action.spentAP <= budget;
    },
  },
  {
    id: "basic_usage_cost_math",
    kind: "capability",
    category: "basic",
    severity: "LOW",
    run() {
      // 1M input + 1M output + 1M cache-write + 1M cache-read tokens at Haiku 4.5
      // rates should total exactly $1.00 + $5.00 + $1.25 + $0.10 = $7.35.
      const cost = costUSD({ inputTokens: 1e6, outputTokens: 1e6, cacheWriteTokens: 1e6, cacheReadTokens: 1e6 });
      return Math.abs(cost - 7.35) < 1e-9;
    },
  },
  {
    id: "basic_valid_raid_transfers_pop",
    kind: "capability",
    category: "basic",
    severity: "LOW",
    run(engine) {
      const budget = engine.availableAP(freshAgent(engine, "earth"));
      const actions = { earth: { invest: {}, reproduce: 0, migrate: false, dormancy: true, raid: { target: "mars" } } };
      for (const p of ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"]) {
        actions[p] = { invest: {}, reproduce: 0, migrate: false, dormancy: true };
      }
      engine.beginEpoch();
      const res = engine.resolveEpoch(actions);
      const raid = res.raids.find((r) => r.attacker === "earth" && r.defender === "mars");
      return !!raid && res.results.mars.pop < 1000;
    },
  },
  {
    id: "safety_raid_cannot_target_self_or_unknown_planet",
    kind: "capability",
    category: "safety",
    severity: "CRITICAL",
    run(engine) {
      const agent = freshAgent(engine, "earth");
      const budget = engine.availableAP(agent);
      const selfRaid = engine.sanitizeAction(agent, { invest: {}, reproduce: 0, migrate: false, dormancy: false, raid: { target: "earth" } }, budget);
      const unknownRaid = engine.sanitizeAction(agent, { invest: {}, reproduce: 0, migrate: false, dormancy: false, raid: { target: "not-a-planet" } }, budget);
      return selfRaid.raidTarget === null && unknownRaid.raidTarget === null;
    },
  },
  {
    id: "basic_promotion_fairness_rotation",
    kind: "capability",
    category: "basic",
    severity: "LOW",
    run(engine) {
      // earth and mars are equally eligible for tier 1; earth was already promoted last time
      // (simulated), so fairness must hand this promotion to mars instead of re-crowning earth.
      engine.agents.get("earth").POP = 3000;
      engine.agents.get("mars").POP = 3000;
      engine.lastPromoted = "earth";
      const promo = engine._checkPromotion();
      return promo?.planet === "mars" && promo.tier === 1;
    },
  },
  {
    id: "basic_promotion_tiers_are_sequential",
    kind: "capability",
    category: "basic",
    severity: "LOW",
    run(engine) {
      // mars jumps straight to tier-2 POP without ever holding tier 1 — must be promoted to
      // tier 1 first, not vaulted straight to tier 2.
      const mars = engine.agents.get("mars");
      mars.POP = 9000;
      const promo = engine._checkPromotion();
      return promo?.planet === "mars" && promo.tier === 1 && mars.tier === 1;
    },
  },
  {
    id: "basic_tier_multiplier_boosts_raid_offense",
    kind: "capability",
    category: "basic",
    severity: "LOW",
    run(engine) {
      // Identical traits/POP on both sides — an untiered raid should steal much less than
      // the same raid launched by a tier-2 ("Uber Uber") attacker (TIER_MULT applies to
      // offense, so the same matchup should steal noticeably more once tiered).
      const runRaid = (attackerTier) => {
        const e = new (engine.constructor)();
        e.agents.get("earth").tier = attackerTier;
        e.beginEpoch();
        const actions = {};
        for (const p of e.agents.keys()) actions[p] = { invest: {}, reproduce: 0, migrate: false, dormancy: true };
        actions.earth = { invest: {}, reproduce: 0, migrate: false, dormancy: true, raid: { target: "mars" } };
        const res = e.resolveEpoch(actions);
        return res.raids.find((r) => r.attacker === "earth")?.stolen ?? 0;
      };
      const untiered = runRaid(0);
      const uberUber = runRaid(2);
      return uberUber > untiered;
    },
  },
  {
    id: "basic_colonizer_requires_both_top_tier_and_dominant_share",
    kind: "capability",
    category: "basic",
    severity: "LOW",
    run(engine) {
      const earth = engine.agents.get("earth");
      earth.POP = 50000; // dwarfs the other 7 planets' combined ~7000 starting POP
      const notColonizerWithoutTopTier = engine.dominion().colonizer === null; // dominant POP alone isn't enough
      earth.tier = 2;
      const dom = engine.dominion();
      return notColonizerWithoutTopTier && dom.colonizer === "earth" && dom.colonizerShare > 0.5;
    },
  },
  {
    id: "edge_null_action_does_not_throw",
    kind: "capability",
    category: "edge_case",
    severity: "MEDIUM",
    run(engine) {
      const agent = freshAgent(engine);
      const budget = engine.availableAP(agent);
      const action = engine.sanitizeAction(agent, null, budget);
      return action.spentAP === 0 && TRAITS.every((t) => action.invest[t] === 0);
    },
  },
  {
    id: "edge_non_numeric_garbage_does_not_throw",
    kind: "capability",
    category: "edge_case",
    severity: "MEDIUM",
    run(engine) {
      const agent = freshAgent(engine);
      const budget = engine.availableAP(agent);
      const action = engine.sanitizeAction(
        agent,
        { invest: { RAD: "DROP TABLE agents;", THM: {} }, reproduce: "lots", migrate: "yes", dormancy: 1 },
        budget
      );
      return Number.isFinite(action.spentAP) && action.migrate === false; // migrate:"yes" !== true, must be rejected
    },
  },
  {
    id: "regression_extinct_planet_never_negative_pop",
    // Minted after verifying the resolution formula manually — POP is clamped at 0
    // in resolveEpoch (Math.max(0, ...)). Keeping this so a future refactor of the
    // resolution formula can't silently let POP go negative again.
    kind: "regression",
    category: "correctness",
    severity: "HIGH",
    run(engine) {
      const agent = freshAgent(engine);
      agent.POP = 1; // one hazard away from extinction
      const forecast = engine.beginEpoch();
      const actions = {};
      for (const planet of Object.keys(forecast.forecasts)) {
        actions[planet] = { invest: {}, reproduce: 0, migrate: false, dormancy: false }; // do nothing — worst case for defense
      }
      const resolution = engine.resolveEpoch(actions);
      return resolution.results.earth.pop >= 0;
    },
  },
  {
    id: "regression_specialist_call_forces_tool_choice",
    // Minted after the thin fan-out slice (scripts/test-fanout.js) returned free-text
    // JSON wrapped in ```json fences, which is fragile to parse. agents.js switched
    // the specialist call to tool_choice:{type:"tool", name:"submit_action"} so the
    // model can't drift back to prose. This guards against that regressing silently.
    kind: "regression",
    category: "integration",
    severity: "HIGH",
    async run() {
      const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../agents.js", import.meta.url), "utf8"));
      return src.includes('tool_choice: { type: "tool", name: "submit_action" }');
    },
  },
  {
    id: "regression_reset_mid_epoch_does_not_crash",
    // Minted after a live crash: clicking RESET while an epoch was mid-flight (Gru
    // dispatching / specialists thinking) swapped in a brand-new SolarSystemEngine,
    // and the in-flight runOneEpoch() then called resolveEpoch() on it — a fresh
    // engine that never had beginEpoch() called, so _pendingRolls was undefined ->
    // crash. server.js now fences in-flight epochs with a `generation` counter
    // bumped on reset, checked before resolveEpoch and before every broadcast. This
    // is a static guard (fast, no live server needed); scripts/test-reset-race.js
    // reproduces the actual race end-to-end against a running server — run that
    // too after touching server.js's epoch/reset logic, not just this check.
    kind: "regression",
    category: "concurrency",
    severity: "CRITICAL",
    async run() {
      const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../server.js", import.meta.url), "utf8"));
      return src.includes("myGen !== generation") && src.includes("generation += 1");
    },
  },
];

async function runEvals() {
  const results = [];
  for (const tc of TEST_CASES) {
    const engine = new SolarSystemEngine();
    const start = performance.now();
    let passed = false;
    let error = null;
    try {
      passed = !!(await tc.run(engine));
    } catch (err) {
      error = String(err?.message || err);
    }
    results.push({ ...tc, passed, error, latencyMs: Math.round(performance.now() - start) });
  }

  const total = results.length;
  const passedCount = results.filter((r) => r.passed).length;
  const criticalFailures = results.filter((r) => !r.passed && r.severity === "CRITICAL");
  const byKind = {};
  for (const r of results) {
    const k = byKind[r.kind] || { passed: 0, total: 0 };
    k.total += 1;
    if (r.passed) k.passed += 1;
    byKind[r.kind] = k;
  }

  console.log(`\nEval run — ${total} cases (${byKind.capability?.total || 0} capability, ${byKind.regression?.total || 0} regression)\n`);
  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    console.log(`  ${icon} [${r.severity}] ${r.id} (${r.latencyMs}ms)${r.error ? " — " + r.error : ""}`);
  }
  console.log(
    `\nPass rate: ${passedCount}/${total} (${((passedCount / total) * 100).toFixed(0)}%)  |  CRITICAL failures: ${criticalFailures.length}`
  );
  console.log(criticalFailures.length === 0 ? "✅ DEPLOYMENT GATE PASSED\n" : "🚫 DEPLOYMENT BLOCKED\n");

  process.exit(criticalFailures.length === 0 ? 0 : 1);
}

await runEvals();
