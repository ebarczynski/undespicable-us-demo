// Full-stack smoke test: engine + real agents, one epoch, no server/UI yet.
import { loadEnv } from "../lib/env.js";
import { SolarSystemEngine } from "../engine.js";
import { initAgents, runEpochAgents } from "../agents.js";

initAgents(loadEnv());
const engine = new SolarSystemEngine();

const forecastPhase = engine.beginEpoch();
console.log(`Epoch ${forecastPhase.epochNumber}, multiplier ${forecastPhase.multiplier.toFixed(2)}`);

const t0 = Date.now();
const events = [];
const actions = await runEpochAgents(forecastPhase, (evt) => events.push({ ...evt, t: Date.now() - t0 }));

console.log("\n--- event stream (ms since dispatch start) ---");
for (const e of events) {
  if (e.type === "coordinator_dispatch") {
    console.log(`t+${e.t}ms  [Gru] dispatched ${e.dispatches.length} garrisons in one message (coordinator call took ${e.coordinatorLatencyMs}ms)`);
  } else if (e.type === "specialist_start") {
    console.log(`t+${e.t}ms  [${e.planet}] start — "${e.orderText}"`);
  } else if (e.type === "specialist_done") {
    const raidNote = e.action.raid ? ` [RAID -> ${e.action.raid.target}]` : "";
    console.log(`t+${e.t}ms  [${e.planet}] done in ${e.latencyMs}ms — "${e.action.battleCry}"${raidNote}`);
  } else if (e.type === "specialist_error") {
    console.log(`t+${e.t}ms  [${e.planet}] ERROR: ${e.error}`);
  }
}

const starts = events.filter((e) => e.type === "specialist_start").map((e) => e.t);
console.log(`\nspecialist start spread: ${Math.max(...starts) - Math.min(...starts)}ms across ${starts.length} planets`);

const resolution = engine.resolveEpoch(actions);
console.log("\n--- resolution ---");
for (const [planet, r] of Object.entries(resolution.results)) {
  console.log(
    `${planet.padEnd(8)} hazard=${r.hazardType} sev=${r.severity} outcome=${r.outcome} popDelta=${r.popDelta} pop=${r.pop}${r.extinct ? " EXTINCT" : ""}`
  );
}
console.log("\nleaderboard:", resolution.leaderboard.map((r) => `${r.planet}:${r.cai}`).join(", "));
console.log("dominion:", resolution.dominion);
if (resolution.raids.length) console.log("raids:", resolution.raids);
else console.log("raids: none this epoch");
if (resolution.panspermia) console.log("\npanspermia:", resolution.panspermia);
