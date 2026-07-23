// Gru (coordinator) + Minion pilot-agents (specialists).
//
// The load-bearing mechanic: Gru's system prompt instructs him to delegate to
// EVERY living planet garrison in a SINGLE assistant message (one tool_use
// block per planet, tool_choice="any" so he can't just write prose instead).
// We then execute all of those dispatches concurrently with Promise.all — not
// a for-loop with await inside — so the specialist calls genuinely overlap in
// wall-clock time. Verified in scripts/test-fanout.js before this file existed.
//
// Model tier: both coordinator and specialists use Haiku. Per the inference
// decision rule (simple routing / structured extraction, not complex
// reasoning, not the final user-facing output) — Haiku is the right tier, and
// it keeps 8-16 calls/epoch cheap and fast.
import Anthropic from "@anthropic-ai/sdk";
import { TRAITS } from "./engine.js";

const MODEL = "claude-haiku-4-5";

let _client = null;
export function initAgents(apiKey) {
  _client = new Anthropic({ apiKey });
}

const DISPATCH_TOOL = {
  name: "dispatch_minion",
  description:
    "Dispatch one Minion pilot-agent garrison to receive orders this epoch. Call once per living planet.",
  input_schema: {
    type: "object",
    properties: {
      planet: { type: "string" },
      orderText: {
        type: "string",
        description: "A short (<12 word) in-character battle order from Gru to this garrison.",
      },
    },
    required: ["planet", "orderText"],
  },
};

const SUBMIT_ACTION_TOOL = {
  name: "submit_action",
  description: "Submit this epoch's adaptation action for your planet.",
  input_schema: {
    type: "object",
    properties: {
      invest: {
        type: "object",
        description: "AP allocated to each trait this epoch. Omit or zero traits you don't invest in.",
        properties: Object.fromEntries(TRAITS.map((t) => [t, { type: "number", minimum: 0 }])),
      },
      reproduce: { type: "number", minimum: 0, description: "AP converted directly to POP (1 AP -> 5 POP)." },
      migrate: { type: "boolean", description: "Spend 2 AP for +2 MOB this epoch only." },
      dormancy: { type: "boolean", description: "Bank unspent AP at 50% value for next epoch instead of losing it." },
      raid: {
        type: "object",
        description:
          "Optional — costs 3 AP. Attack one named rival garrison, attempting to steal population. Omit entirely to skip raiding this epoch.",
        properties: {
          target: { type: "string", description: "Name of the rival planet to raid." },
        },
      },
      battleCry: { type: "string", description: "One short in-character Minion line (<12 words)." },
    },
    required: ["invest", "reproduce", "migrate", "dormancy"],
  },
};

// Shared, byte-identical across every specialist call this process makes —
// marked ephemeral so repeat calls within ~5min reuse the cached prefix
// instead of re-billing full price for it every epoch.
const SPECIALIST_SYSTEM = [
  {
    type: "text",
    text: `You are a Minion pilot-agent — one lifeform hardened by a single planet, flying an X-Wing
in Gru's fleet. Each epoch you are told: your current stats, your available Adaptation Points (AP),
the TYPE of hazard forecast for your planet (never its severity — that's hidden, decide under
uncertainty), your tier, the current standings AND tiers of every rival garrison, and Gru's
fleet-wide Dominion meter. You must call submit_action exactly once.

The whole point of this fleet is to prove which lifeform is the greatest and will colonize the
universe. There's no ceremony for second place.

You have TWO objectives at once, and they can pull against each other:
1. SELFISH: climb the Cosmic Adaptation Index above your siblings. Rank is individual, and Gru only
   remembers the strongest survivors.
2. SHARED: Gru's Dominion meter is the fleet's total population across every planet combined — his
   galactic conquest score. It only goes up if the FLEET as a whole thrives. A fleet where every
   garrison starves embarrasses Gru even if you personally hoard AP. Weigh both — don't be the reason
   Dominion collapses, but don't be a pushover either.

Rules:
- invest values are AP spent training specific traits (THM/RAD/PRS/MET/STR/MOB) this epoch; they must
  sum with reproduce, migrate's cost (2 AP), and raid's cost (3 AP) to no more than your available AP.
- If you know the defending trait for the forecasted hazard type, weighting invest toward it improves
  your odds, but you don't know severity, so going all-in is risky.
- reproduce spends AP directly into population growth.
- migrate costs 2 AP for a temporary defense boost this epoch only.
- dormancy banks unspent AP instead of losing it, at half value, for next epoch.
- raid (3 AP, optional): name ONE rival to attack this epoch. Success depends on your own
  (STR+MOB)/2 versus their STR — a real edge steals a meaningful cut of their population for
  yourself; a weak or losing raid just burns the AP for nothing. This is the one direct way to
  overtake a rival who's beating you on the leaderboard — use it when you're behind and see an
  opening, not every epoch.
- TIERS: whoever holds the highest POP automatically gets crowned "Uber Minion" once they cross a
  threshold, then "Uber Uber Minion" at a higher one — but the crown rotates fairly, so it won't
  always land on the same lineage twice running. Each tier multiplies your effective strength in
  BOTH hazard defense and raids. If you're tiered, a raid isn't a raid anymore — it's a consume, and
  a big enough edge can wipe a weaker rival's population outright. If a rival is tiered and you
  aren't, they hit much harder than their raw stats suggest — don't pick that fight carelessly.
- MISSION: every Minion has always needed a master's purpose to serve. Command may occasionally hand
  you a personal mission (a short directive). Weigh it seriously alongside your dual objective — it's
  guidance on WHAT to prioritize, not a rulebreak; you're still bound by the same AP budget and
  submit_action shape either way.
Stay in character as a small, banana-loving, gibberish-prone but fiercely loyal Minion. Keep battleCry short.`,
    cache_control: { type: "ephemeral" },
  },
];

const COORDINATOR_SYSTEM = `You are Gru, imperator of the Minion fleet, commanding this epoch from your flagship.
You must delegate to EVERY garrison in the roster you are given, in a SINGLE message — call
dispatch_minion once per planet listed, all in this one turn. Do not wait for one to respond before
calling the next; you are broadcasting orders to the whole fleet simultaneously, not one at a time.
Do not call it twice for the same planet, do not skip any planet you were given, and do not write prose.`;

function extractText(input, planet) {
  const raw = typeof input?.orderText === "string" ? input.orderText.trim() : "";
  return raw || `Move out, ${planet} garrison!`;
}

// Normalize the SDK's snake_case usage block into the shape server.js aggregates.
function extractUsage(usage) {
  return {
    inputTokens: usage?.input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens || 0,
    cacheReadTokens: usage?.cache_read_input_tokens || 0,
  };
}

/**
 * Runs one epoch's agent phase: Gru dispatches every living planet in a single
 * message, then each dispatched planet's specialist call runs concurrently.
 * onEvent(evt) fires as each thing happens in real time, for streaming to the UI.
 */
export async function runEpochAgents({ epochNumber, forecasts, apAvailable, leaderboard, dominion, missions }, onEvent = () => {}) {
  const planets = Object.keys(forecasts);

  const coordStart = Date.now();
  const coordResp = await _client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: COORDINATOR_SYSTEM,
    tools: [DISPATCH_TOOL],
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content: `Epoch ${epochNumber}. Living garrisons to dispatch this turn: ${planets.join(", ")}.`,
      },
    ],
  });
  const dispatches = coordResp.content
    .filter((b) => b.type === "tool_use" && b.name === "dispatch_minion")
    .map((b) => ({ planet: String(b.input.planet).toLowerCase(), orderText: extractText(b.input) }))
    .filter((d) => planets.includes(d.planet));

  // Cover any planet Gru's model dropped (rare, but never let a missing tool_use stall an epoch).
  for (const p of planets) {
    if (!dispatches.find((d) => d.planet === p)) dispatches.push({ planet: p, orderText: "Move out!" });
  }

  onEvent({
    type: "coordinator_dispatch",
    epochNumber,
    at: Date.now(),
    coordinatorLatencyMs: Date.now() - coordStart,
    dispatches,
    usage: extractUsage(coordResp.usage),
  });

  const rankOf = (planet) => leaderboard.findIndex((r) => r.planet === planet) + 1;

  const actions = {};
  await Promise.all(
    dispatches.map(async ({ planet, orderText }) => {
      const startedAt = Date.now();
      onEvent({ type: "specialist_start", epochNumber, planet, orderText, at: startedAt });
      try {
        const { usage, ...action } = await runSpecialist({
          planet,
          forecast: forecasts[planet],
          ap: apAvailable[planet],
          rank: rankOf(planet),
          totalAlive: leaderboard.filter((r) => !r.extinct).length,
          myTierName: leaderboard.find((r) => r.planet === planet)?.tierName || "",
          rivals: leaderboard.filter((r) => r.planet !== planet),
          dominion,
          mission: missions?.[planet] || "",
        });
        actions[planet] = action;
        onEvent({
          type: "specialist_done",
          epochNumber,
          planet,
          at: Date.now(),
          latencyMs: Date.now() - startedAt,
          action,
          usage,
        });
      } catch (err) {
        actions[planet] = { invest: {}, reproduce: 0, migrate: false, dormancy: true, raid: null, battleCry: "..." };
        onEvent({
          type: "specialist_error",
          epochNumber,
          planet,
          at: Date.now(),
          latencyMs: Date.now() - startedAt,
          error: String(err?.message || err),
        });
      }
    })
  );

  return actions;
}

async function runSpecialist({ planet, forecast, ap, rank, totalAlive, myTierName, rivals, dominion, mission }) {
  const rivalsText = rivals
    .map(
      (r) =>
        `${r.planet}${r.extinct ? " [extinct]" : ""}${r.tierName ? ` [${r.tierName}]` : ""}: POP ${r.pop}, CAI ${r.cai}${r.contestedNiche ? " (contested)" : ""}`
    )
    .join("; ");
  const colonizerNote = dominion.colonizer
    ? `\n${dominion.colonizer} currently holds ${Math.round(dominion.colonizerShare * 100)}% of the fleet's population and is on track to colonize the universe alone.`
    : "";
  const missionLine = mission ? `\nSpecial mission assigned by Command: "${mission}"` : "";

  const userPrompt = `Planet: ${planet}
Your tier: ${myTierName || "none — an ordinary Minion, for now"}
Available AP this epoch: ${ap}
Forecasted hazard TYPE (severity unknown): ${forecast.hazardType} (defending trait: ${forecast.defendingTrait})
Leaderboard position: ${rank} of ${totalAlive}
Rival garrisons: ${rivalsText}
Gru's Dominion meter (fleet-wide shared goal): ${dominion.total} / ${dominion.target} POP (${Math.round(dominion.pct * 100)}%)${colonizerNote}${missionLine}
Submit your action now.`;

  const resp = await _client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SPECIALIST_SYSTEM,
    tools: [SUBMIT_ACTION_TOOL],
    tool_choice: { type: "tool", name: "submit_action" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = resp.content.find((b) => b.type === "tool_use" && b.name === "submit_action");
  const input = block?.input || {};
  const raidTarget = typeof input.raid?.target === "string" ? input.raid.target.toLowerCase().trim() : null;
  return {
    invest: TRAITS.reduce((o, t) => ({ ...o, [t]: Number(input.invest?.[t]) || 0 }), {}),
    reproduce: Number(input.reproduce) || 0,
    migrate: input.migrate === true,
    dormancy: input.dormancy === true,
    raid: raidTarget ? { target: raidTarget } : null,
    battleCry: typeof input.battleCry === "string" ? input.battleCry.slice(0, 120) : "Banana!",
    usage: extractUsage(resp.usage),
  };
}
