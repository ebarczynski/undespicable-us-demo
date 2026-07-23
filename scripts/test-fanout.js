// Thin de-risking slice: prove the coordinator (Gru) emits ALL specialist
// tool_use blocks in a SINGLE message, and that we execute them concurrently
// (not a for-loop with await inside). No visuals, no engine — just the
// parallelism mechanic that everything else depends on.
import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "../lib/env.js";

const apiKey = loadEnv();
const client = new Anthropic({ apiKey });

const HAIKU = "claude-haiku-4-5";
const PLANETS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];

async function sanityPing() {
  const start = Date.now();
  const resp = await client.messages.create({
    model: HAIKU,
    max_tokens: 16,
    messages: [{ role: "user", content: "Reply with the single word: pong" }],
  });
  console.log(`[sanity] model=${HAIKU} ok in ${Date.now() - start}ms ->`, resp.content[0].text.trim());
}

const dispatchTool = {
  name: "dispatch_minion",
  description: "Dispatch one Minion pilot-agent to a planet for this epoch. Call this once per planet that needs orders.",
  input_schema: {
    type: "object",
    properties: {
      planet: { type: "string", enum: PLANETS },
    },
    required: ["planet"],
  },
};

async function runCoordinator() {
  const system = `You are Gru, imperator of the Minion fleet, commanding from your flagship.
Every epoch you must send orders to all ${PLANETS.length} planet garrisons: ${PLANETS.join(", ")}.
Delegate to ALL ${PLANETS.length} specialists in a SINGLE message — call the dispatch_minion tool
once per planet, all in this one turn. Do NOT wait for one to respond before calling the next.
Do not call the tool for the same planet twice. Do not write prose, only call the tool.`;

  const start = Date.now();
  const resp = await client.messages.create({
    model: HAIKU,
    max_tokens: 1024,
    system,
    tools: [dispatchTool],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: "Begin epoch 1. Dispatch the fleet." }],
  });
  const elapsed = Date.now() - start;

  const toolCalls = resp.content.filter((b) => b.type === "tool_use");
  const planetsCalled = toolCalls.map((b) => b.input.planet);

  console.log(`\n[coordinator] one message returned in ${elapsed}ms`);
  console.log(`[coordinator] tool_use blocks in that single message: ${toolCalls.length}`);
  console.log(`[coordinator] planets: ${planetsCalled.join(", ")}`);

  const allPresent = PLANETS.every((p) => planetsCalled.includes(p));
  const singleMessage = toolCalls.length === PLANETS.length;
  console.log(
    singleMessage && allPresent
      ? "[coordinator] PASS — all specialists delegated in one message\n"
      : "[coordinator] FAIL — did not get one tool_use block per planet in a single message\n"
  );

  return toolCalls;
}

async function runSpecialist(planet) {
  const startedAt = Date.now();
  const resp = await client.messages.create({
    model: HAIKU,
    max_tokens: 200,
    system:
      "You are a Minion pilot-agent stationed on one planet. Given only your planet name, " +
      'respond with ONLY compact JSON: {"planet": "<name>", "note": "<one short battle-cry, in character as a Minion>"}',
    messages: [{ role: "user", content: `Your planet: ${planet}` }],
  });
  const finishedAt = Date.now();
  return { planet, startedAt, finishedAt, text: resp.content[0].text.trim() };
}

async function runFanoutExecution(toolCalls) {
  console.log("[fanout] executing all specialist calls concurrently via Promise.all...");
  const t0 = Date.now();
  // THE point being proven: Promise.all, not a for-loop with await inside.
  const results = await Promise.all(toolCalls.map((tc) => runSpecialist(tc.input.planet)));
  const totalElapsed = Date.now() - t0;

  const startSpread = Math.max(...results.map((r) => r.startedAt)) - Math.min(...results.map((r) => r.startedAt));
  console.log(`\n[fanout] ${results.length} specialist calls, wall clock ${totalElapsed}ms total`);
  console.log(`[fanout] spread between first and last START timestamp: ${startSpread}ms`);
  for (const r of results.sort((a, b) => a.startedAt - b.startedAt)) {
    console.log(`  t+${r.startedAt - t0}ms  ${r.planet.padEnd(8)} -> ${r.text}`);
  }

  const sumOfDurations = results.reduce((s, r) => s + (r.finishedAt - r.startedAt), 0);
  console.log(
    `\n[fanout] sum of individual call durations = ${sumOfDurations}ms, actual wall clock = ${totalElapsed}ms`
  );
  console.log(
    totalElapsed < sumOfDurations * 0.7
      ? "[fanout] PASS — wall clock is well under the serial sum; calls overlapped in time\n"
      : "[fanout] SUSPICIOUS — wall clock is close to the serial sum; check for accidental serialization\n"
  );
}

await sanityPing();
const toolCalls = await runCoordinator();
if (toolCalls.length > 0) await runFanoutExecution(toolCalls);
