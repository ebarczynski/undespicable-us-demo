// Reproduces the exact race that used to crash the server: fire "start", then
// "reset" while the first epoch is still mid-flight (Gru dispatching /
// specialists thinking), and confirm the server survives and remains fully
// functional afterward — no engine_error, no stale epoch_resolved leaking
// through after the reset's snapshot, and a subsequent step works cleanly.
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:4173/ws");
let resetSentAt = null;
let cleanStepSentAt = null;
let sawEngineError = false;
let sawStaleResolutionLeak = false;

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "start" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  console.log("<-", msg.type);

  if (msg.type === "coordinator_dispatch" && resetSentAt === null) {
    resetSentAt = Date.now();
    console.log("-> mid-flight, sending reset NOW");
    ws.send(JSON.stringify({ type: "reset" }));
  }

  if (msg.type === "engine_error") sawEngineError = true;

  if (msg.type === "epoch_resolved") {
    if (cleanStepSentAt === null) {
      // any epoch_resolved arriving before we've asked for the post-reset step
      // is a leak from the discarded in-flight run
      sawStaleResolutionLeak = true;
    } else {
      console.log("\npost-reset step resolved cleanly, leaderboard:", msg.leaderboard.map((r) => r.planet + ":" + r.cai).join(", "));
      console.log("engine_error occurred:", sawEngineError, "(must be false)");
      console.log("stale epoch_resolved leaked after reset:", sawStaleResolutionLeak, "(must be false)");
      console.log(sawEngineError || sawStaleResolutionLeak ? "\nFAIL" : "\nPASS — no crash, no leak, clean step worked");
      process.exit(sawEngineError || sawStaleResolutionLeak ? 1 : 0);
    }
  }

  // once we've received the reset's own snapshot, wait a beat (long enough for
  // any stale in-flight resolution to have leaked, if the bug were still present)
  // then request a clean step to prove the server is fully healthy
  if (msg.type === "snapshot" && resetSentAt !== null && cleanStepSentAt === null) {
    setTimeout(() => {
      cleanStepSentAt = Date.now();
      console.log("\nsending a clean step post-reset to confirm server still works...");
      ws.send(JSON.stringify({ type: "step" }));
    }, 4000);
  }
});

ws.on("error", (e) => {
  console.error("ws error", e);
  process.exit(1);
});
setTimeout(() => {
  console.error("timed out");
  process.exit(1);
}, 60000); // generous: a full post-reset epoch is coordinator + 8 parallel specialist calls
