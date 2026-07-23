// Real headless-DOM smoke test — loads the ACTUAL served page into jsdom against the live
// server and executes the ACTUAL app.js/sim.js/funmode.js/ws.js source for real, then clicks
// through the tab UI. jsdom does not execute <script type="module"> at all (a known jsdom
// limitation, not something real browsers do) — so the module files are concatenated into one
// classic script (imports/exports stripped) and injected directly. This is the closest thing
// to "open it in a browser" available without one: it catches real runtime exceptions (missing
// elements, null derefs, dead event listeners) that `node --check` (syntax only) and the
// headless logic test (imports sim.js in isolation, no real page/module loading) both miss.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsDir = path.join(__dirname, "..", "public", "js");
const BASE = "http://localhost:4173/";

// Real ES modules each get their own top-level scope, so identically-named top-level
// consts in two files (e.g. GRU_ASPECT in both sim.js and funmode.js) never collide.
// Flattening into one classic script loses that — so each file is wrapped in its own
// block, and only the symbols it actually exports cross into a shared namespace, exactly
// like a real module boundary.
function stripModuleSyntax(src) {
  return src
    .split("\n")
    .filter((line) => !/^import .* from ["'].*["'];?$/.test(line.trim()))
    .join("\n")
    .replace(/^export\s+(class|function|const|let|var)\s/gm, "$1 ")
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, "");
}

const FILES = [
  { name: "ws.js", exports: ["connect"] },
  { name: "sim.js", exports: ["SwarmSim"] },
  { name: "funmode.js", exports: ["FunMode"] },
  { name: "app.js", exports: [], imports: ["connect", "SwarmSim", "FunMode"] },
];

const bundle = FILES.map(({ name, exports, imports }) => {
  const body = stripModuleSyntax(readFileSync(path.join(jsDir, name), "utf8"));
  const importLine = imports?.length ? `const { ${imports.join(", ")} } = window.__bundle;\n` : "";
  const exportLines = (exports || []).map((e) => `window.__bundle.${e} = ${e};`).join("\n");
  return `{\n${importLine}${body}\n${exportLines}\n}`;
}).join("\n");

const bundlePrelude = "window.__bundle = window.__bundle || {};\n";

const errors = [];

const dom = await JSDOM.fromURL(BASE, {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  beforeParse(window) {
    // jsdom has no WebSocket implementation — stub one so connect()'s real logic runs
    // without crashing on a missing global (a jsdom gap; every real browser has WebSocket).
    window.WebSocket = class {
      constructor() {
        this.readyState = 0;
      }
      send() {}
      close() {}
    };
    // jsdom doesn't implement Canvas 2D (needs the native `canvas` package) — stub a
    // no-op context so the real draw loop runs without crashing on a null context.
    // This only affects rendering fidelity (irrelevant here); it doesn't touch any
    // DOM/event logic, which is what this test is actually verifying.
    const fakeGradient = { addColorStop() {} };
    window.HTMLCanvasElement.prototype.getContext = () =>
      new Proxy(
        {
          measureText: () => ({ width: 10 }),
          canvas: { width: 800, height: 600 },
          createRadialGradient: () => fakeGradient,
          createLinearGradient: () => fakeGradient,
        },
        { get: (t, p) => (p in t ? t[p] : () => {}) }
      );
    window.addEventListener("error", (e) => errors.push(e.error?.stack || e.message));
    window.onunhandledrejection = (e) => errors.push("unhandled rejection: " + (e.reason?.stack || e.reason));
  },
});

const { window } = dom;
const doc = window.document;

// The page's own <script type="module"> tag is inert under jsdom — inject the real app
// code (bundled to classic-script syntax) directly so it executes for real.
const script = doc.createElement("script");
script.textContent = bundlePrelude + bundle;
doc.body.appendChild(script);

await new Promise((r) => setTimeout(r, 300));

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS:", msg);
}

assert(errors.length === 0, `no uncaught runtime errors on load (saw: ${JSON.stringify(errors)})`);

const tabButtons = doc.querySelectorAll(".tab-btn");
assert(tabButtons.length === 3, `found 3 tab buttons (got ${tabButtons.length})`);
assert(doc.querySelector('.tab-btn[data-view="command"]').classList.contains("active"), "command tab starts active");

const settingsView = doc.getElementById("settings-view");
const chronicleView = doc.getElementById("chronicle-view");
assert(settingsView.classList.contains("hidden"), "settings view starts hidden");
assert(chronicleView.classList.contains("hidden"), "chronicle view starts hidden");

// Click Settings — the exact user action being verified.
const settingsBtn = doc.querySelector('.tab-btn[data-view="settings"]');
settingsBtn.click();
assert(errors.length === 0, `no runtime errors after clicking Settings (saw: ${JSON.stringify(errors)})`);
assert(!settingsView.classList.contains("hidden"), "settings view becomes visible after clicking its tab");
assert(settingsBtn.classList.contains("active"), "settings tab button shows active state");

const missionInputs = doc.querySelectorAll("#mission-grid input");
assert(missionInputs.length === 8, `mission grid has one input per planet (got ${missionInputs.length})`);
assert(missionInputs[0].id.startsWith("mission-"), "mission inputs have the expected id shape");

doc.getElementById("btn-close-settings").click();
assert(settingsView.classList.contains("hidden"), "settings view hides again after Close");
assert(doc.querySelector('.tab-btn[data-view="command"]').classList.contains("active"), "command tab re-activates after Close");

doc.querySelector('.tab-btn[data-view="chronicle"]').click();
assert(!chronicleView.classList.contains("hidden"), "chronicle view becomes visible after clicking its tab");
doc.getElementById("btn-close-chronicle").click();
assert(chronicleView.classList.contains("hidden"), "chronicle view hides again after Close");

// Escape should close whatever page-view is open.
doc.querySelector('.tab-btn[data-view="settings"]').click();
window.document.dispatchEvent(new window.KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
window.dispatchEvent(new window.KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
assert(settingsView.classList.contains("hidden"), "Escape closes an open page-view back to Command");

console.log("\nALL DOM SMOKE CHECKS PASSED");
window.close();
