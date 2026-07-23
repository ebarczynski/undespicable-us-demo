// Headless logic check for public/js/sim.js. No jsdom dependency — just enough
// DOM/canvas stubbing to exercise posOf/dragging/dominion-driven spread+shake,
// since this frontend logic otherwise only gets verified by a human in a browser.
import assert from "node:assert/strict";

function fakeEl() {
  const el = {
    style: {},
    children: [],
    textContent: "",
    innerHTML: "",
    appendChild(child) {
      el.children.push(child);
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
    },
    classList: { add() {}, remove() {}, contains() { return false; } },
    scrollTop: 0,
  };
  return el;
}

global.document = {
  getElementById() { return fakeEl(); },
  querySelector() { return fakeEl(); },
  createElement() { return fakeEl(); },
};

global.Image = class {
  set src(_v) {} // never fires onload in this headless check — gruImgLoaded stays false, which is fine
};

function fakeCtx() {
  return new Proxy(
    { measureText: () => ({ width: 10 }) },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );
}

const canvas = {
  clientWidth: 1200,
  clientHeight: 800,
  style: {},
  getContext() { return fakeCtx(); },
};

const { SwarmSim } = await import("../public/js/sim.js");
const sim = new SwarmSim(canvas);

// 1. dominion growth spreads the fleet outward and shakes the world
const posBefore = { ...sim.posOf("earth") };
sim.updateDominion({ total: 8000, target: 12000, pct: 0.2 }); // first call — baseline, no shake
sim.layoutPositions();
sim.updateDominion({ total: 10000, target: 12000, pct: 0.5 }); // real jump — should shake
assert.ok(performance.now() < sim.shake.until, "a big dominion jump should trigger a shake");
for (let i = 0; i < 60; i++) sim.layoutPositions(); // let the eased spread catch up to target
const posAfter = sim.posOf("earth");
const cx = canvas.clientWidth * 0.5;
const cy = canvas.clientHeight * 0.62;
const distBefore = Math.hypot(posBefore.x - cx, posBefore.y - cy);
const distAfter = Math.hypot(posAfter.x - cx, posAfter.y - cy);
assert.ok(distAfter > distBefore, `fleet should spread outward as dominion grows (before=${distBefore.toFixed(1)}, after=${distAfter.toFixed(1)})`);
console.log("PASS: dominion growth spreads the fleet outward and triggers a shake");

// 2. dragging overrides the computed layout position
const grabbed = sim.onPointerDown(posAfter.x, posAfter.y); // click exactly on earth's current spot
assert.equal(grabbed, true, "clicking on a ship should report a grab");
assert.equal(sim.draggingPlanet, "earth", "clicking on a ship should start dragging it");
sim.onPointerMove(999, 111);
assert.deepEqual(sim.posOf("earth"), { x: 999, y: 111 }, "dragged ship should report the manual position");
sim.onPointerUp();
assert.equal(sim.draggingPlanet, null, "releasing should stop dragging");
assert.deepEqual(sim.posOf("earth"), { x: 999, y: 111 }, "manual position should persist after release");
console.log("PASS: drag sets and releases a manual position override that persists");

// 3. clicking empty space does not start a drag
const grabbedEmpty = sim.onPointerDown(5, 5);
assert.equal(grabbedEmpty, false, "clicking empty space should not grab a ship");
assert.equal(sim.draggingPlanet, null);
console.log("PASS: empty-space click does not start a drag");

console.log("\nALL SIM LOGIC CHECKS PASSED");
