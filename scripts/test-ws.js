import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:4173/ws");
let count = 0;
ws.on("open", () => {
  console.log("connected, requesting one epoch step...");
  ws.send(JSON.stringify({ type: "step" }));
});
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  count++;
  console.log(`[${count}] ${msg.type}` + (msg.type === "coordinator_dispatch" ? ` (${msg.dispatches.length} dispatches)` : ""));
  if (msg.type === "epoch_resolved") {
    console.log("epoch_resolved leaderboard:", msg.leaderboard.map((r) => r.planet + ":" + r.cai).join(", "));
    setTimeout(() => process.exit(0), 200);
  }
});
ws.on("error", (e) => {
  console.error("ws error", e);
  process.exit(1);
});
setTimeout(() => {
  console.error("timed out waiting for epoch_resolved");
  process.exit(1);
}, 20000);
