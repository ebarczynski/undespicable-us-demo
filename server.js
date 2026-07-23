import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv, ROOT_DIR } from "./lib/env.js";
import { SolarSystemEngine } from "./engine.js";
import { initAgents, runEpochAgents } from "./agents.js";
import { emptyUsage, addUsage, sumUsage, usageBreakdown } from "./lib/usage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4173;

// The pause between epochs, not the Claude calls, is the one lever we control —
// coordinator + parallel specialist latency (~2-5s/epoch) is the floor either way.
const SPEED_LEVELS = [
  { label: "1×", pauseMs: 2600 },
  { label: "2×", pauseMs: 900 },
  { label: "4×", pauseMs: 0 },
];
let speedIndex = 0;

let apiKey;
try {
  apiKey = loadEnv();
} catch (err) {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
}
initAgents(apiKey);

let engine = new SolarSystemEngine();
let running = false;
let epochInFlight = false;
let generation = 0; // bumped on reset — lets an in-flight epoch detect its engine got swapped out

// Token usage/cost — persists across resets (a reset restarts the sim, not the bill).
const usage = { coordinator: emptyUsage(), specialists: emptyUsage() };
function usageSnapshot() {
  return {
    coordinator: usageBreakdown(usage.coordinator),
    specialists: usageBreakdown(usage.specialists),
    total: usageBreakdown(sumUsage(usage.coordinator, usage.specialists)),
  };
}

const app = express();
app.use(express.static(path.join(ROOT_DIR, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

async function runOneEpoch() {
  if (epochInFlight) return;
  epochInFlight = true;
  const activeEngine = engine;
  const myGen = generation;
  // Reset swaps in a brand-new engine — if that happens mid-flight (agents still
  // dispatching), this run's events and final resolution belong to a discarded
  // engine instance and must not be broadcast (the resolveEpoch would also throw:
  // the new engine never had beginEpoch() called on it, so _pendingRolls is unset).
  const guardedBroadcast = (msg) => {
    if (myGen !== generation) return;
    if (msg.type === "coordinator_dispatch" && msg.usage) addUsage(usage.coordinator, msg.usage);
    if (msg.type === "specialist_done" && msg.usage) addUsage(usage.specialists, msg.usage);
    broadcast(msg);
    if (msg.type === "coordinator_dispatch" || msg.type === "specialist_done") {
      broadcast({ type: "usage_update", ...usageSnapshot() });
    }
  };
  try {
    const forecast = activeEngine.beginEpoch();
    guardedBroadcast({ type: "epoch_forecast", ...forecast });

    const actions = await runEpochAgents(forecast, guardedBroadcast);

    if (myGen !== generation) return; // discarded by a reset while agents were dispatching

    const resolution = activeEngine.resolveEpoch(actions);
    guardedBroadcast({ type: "epoch_resolved", ...resolution });
  } catch (err) {
    console.error("epoch failed:", err);
    guardedBroadcast({ type: "engine_error", message: String(err?.message || err) });
    running = false;
  } finally {
    epochInFlight = false;
  }
}

async function autoLoop() {
  while (running) {
    await runOneEpoch();
    if (!running) break;
    await new Promise((r) => setTimeout(r, SPEED_LEVELS[speedIndex].pauseMs));
  }
}

wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "snapshot",
      running,
      speed: SPEED_LEVELS[speedIndex].label,
      usage: usageSnapshot(),
      ...engine.snapshot(),
    })
  );

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "start") {
      if (!running) {
        running = true;
        broadcast({ type: "sim_state", running, speed: SPEED_LEVELS[speedIndex].label });
        autoLoop();
      }
    } else if (msg.type === "stop") {
      running = false;
      broadcast({ type: "sim_state", running, speed: SPEED_LEVELS[speedIndex].label });
    } else if (msg.type === "step") {
      if (!running) runOneEpoch();
    } else if (msg.type === "cycleSpeed") {
      speedIndex = (speedIndex + 1) % SPEED_LEVELS.length;
      broadcast({ type: "sim_state", running, speed: SPEED_LEVELS[speedIndex].label });
    } else if (msg.type === "reset") {
      running = false;
      generation += 1;
      engine = new SolarSystemEngine();
      broadcast({
        type: "snapshot",
        running,
        speed: SPEED_LEVELS[speedIndex].label,
        usage: usageSnapshot(),
        ...engine.snapshot(),
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  Minion swarm sim running -> http://localhost:${PORT}\n`);
});
