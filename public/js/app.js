import { connect } from "./ws.js";
import { SwarmSim } from "./sim.js";
import { FunMode } from "./funmode.js";

const canvas = document.getElementById("scene");

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", resize);
resize();

const sim = new SwarmSim(canvas);
const fun = new FunMode(canvas);

const socket = connect((msg) => sim.handleMessage(msg));

document.getElementById("btn-start").onclick = () => socket.send({ type: "start" });
document.getElementById("btn-stop").onclick = () => socket.send({ type: "stop" });
document.getElementById("btn-step").onclick = () => socket.send({ type: "step" });
document.getElementById("btn-speed").onclick = () => socket.send({ type: "cycleSpeed" });
document.getElementById("btn-reset").onclick = () => socket.send({ type: "reset" });

// ---- Tab navigation: Command / Chronicle / Settings — the sim keeps running
// server-side underneath regardless of which tab is showing. ----
const tabButtons = document.querySelectorAll(".tab-btn");
const chronicleView = document.getElementById("chronicle-view");
const settingsView = document.getElementById("settings-view");

function setView(view) {
  chronicleView.classList.toggle("hidden", view !== "chronicle");
  settingsView.classList.toggle("hidden", view !== "settings");
  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.view === view));
}
function currentView() {
  if (!chronicleView.classList.contains("hidden")) return "chronicle";
  if (!settingsView.classList.contains("hidden")) return "settings";
  return "command";
}
tabButtons.forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
document.getElementById("btn-close-chronicle").onclick = () => setView("command");
document.getElementById("btn-close-settings").onclick = () => setView("command");
document.getElementById("btn-export-log").onclick = () => sim.exportLog();

// ---- per-planet mission inputs (live — applied starting next epoch, no restart) ----
sim.buildMissionGrid((planet, mission) => socket.send({ type: "setMission", planet, mission }));

// ---- Fun Mode key-combo toggle: type G, R, U in sequence (Escape also exits) ----
let combo = "";
window.addEventListener("keydown", (e) => {
  const typingInField = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";

  if (!typingInField && !e.repeat && /^[a-z]$/i.test(e.key)) {
    combo = (combo + e.key.toLowerCase()).slice(-3);
    if (combo === "gru") {
      combo = "";
      toggleFunMode();
    }
  }
  if (e.code === "Escape") {
    if (fun.active) toggleFunMode(false);
    else if (currentView() !== "command") setView("command");
  }

  if (fun.active) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    fun.onKeyDown(e.code);
  }
});
window.addEventListener("keyup", (e) => {
  if (fun.active) fun.onKeyUp(e.code);
});

function toggleFunMode(forceOn) {
  const goActive = forceOn !== undefined ? forceOn : !fun.active;
  if (goActive) {
    setView("command");
    fun.activate();
  } else {
    fun.deactivate();
  }
}

// ---- drag a Minion ship to reposition it (Command view only) ----
canvas.style.cursor = "grab";
function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
canvas.addEventListener("pointerdown", (e) => {
  if (fun.active) return;
  const { x, y } = canvasPoint(e);
  sim.onPointerDown(x, y);
});
window.addEventListener("pointermove", (e) => {
  if (fun.active) return;
  const { x, y } = canvasPoint(e);
  sim.onPointerMove(x, y);
});
window.addEventListener("pointerup", () => {
  if (!fun.active) sim.onPointerUp();
});

// ---- main render loop — the swarm sim keeps running server-side even while
// you're off flying Fun Mode; flipping back shows wherever the epoch loop got to.
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (fun.active) {
    fun.update(dt, now);
    fun.draw(now);
  } else {
    sim.draw(now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
