import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:4173/ws");
ws.on("open", () => {
  console.log("connected — cycling speed 3x (1x -> 2x -> 4x -> back to 1x)");
  ws.send(JSON.stringify({ type: "cycleSpeed" }));
});
let cycles = 0;
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "sim_state") {
    console.log("sim_state speed:", msg.speed);
    cycles++;
    if (cycles < 4) ws.send(JSON.stringify({ type: "cycleSpeed" }));
    else process.exit(0);
  }
});
ws.on("error", (e) => {
  console.error(e);
  process.exit(1);
});
setTimeout(() => {
  console.error("timeout");
  process.exit(1);
}, 5000);
