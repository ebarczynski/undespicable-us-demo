import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:4173/ws");
let resolvedCount = 0;

ws.on("open", () => {
  console.log("connected, starting auto-loop...");
  ws.send(JSON.stringify({ type: "start" }));
});
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "sim_state") console.log("sim_state running=", msg.running);
  if (msg.type === "epoch_resolved") {
    resolvedCount++;
    console.log(`epoch ${msg.epochNumber} resolved (#${resolvedCount})`);
    if (resolvedCount === 2) {
      ws.send(JSON.stringify({ type: "stop" }));
      setTimeout(() => process.exit(0), 500);
    }
  }
});
ws.on("error", (e) => {
  console.error("ws error", e);
  process.exit(1);
});
setTimeout(() => {
  console.error("timed out — auto-loop did not complete 2 epochs");
  process.exit(1);
}, 30000);
