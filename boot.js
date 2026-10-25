// Starts the browser build (docs/web.md): checks for WebGPU, waits for a click (the
// AudioContext and pointer lock need a user gesture), then runs the game's module, whose
// `fn main` is the wasm start function.
//
// The game talks back through two optional globals:
// - window.horizonProgress(label, fraction): loading progress, fraction in 0..=1;
// - window.horizonError(message): a fatal error, shown over the game.
// Every user gesture is announced as the window event 'horizon-gesture', so Rust can resume
// audio from it without exported functions.

const $ = (selector) => document.querySelector(selector);

const progress = $("#progress");
let progressHide = null;
let progressCalls = 0;

// Each phase may run from 0 to 1; reaching 1 hides the bar until the next phase shows it.
window.horizonProgress = (label, fraction) => {
  progressCalls++;
  clearTimeout(progressHide);
  progressHide = null;
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  progress.hidden = false;
  progress.querySelector(".label").textContent = String(label);
  progress.querySelector(".fill").style.width = `${(f * 100).toFixed(1)}%`;
  if (f >= 1) progressHide = setTimeout(() => (progress.hidden = true), 300);
};

let failed = false;
window.horizonError = (message) => {
  failed = true;
  progress.hidden = true;
  $("#start").hidden = true;
  const text = String(message);
  const [summary, ...rest] = text.split("\n");
  $("#error .summary").textContent = summary;
  $("#error pre").textContent = rest.join("\n").trim();
  $("#error").hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
};

function fail(title, detail) {
  window.horizonError(detail ? `${title}\n${detail}` : title);
}

const gesture = () => window.dispatchEvent(new CustomEvent("horizon-gesture"));

// Fetched (once WebGPU is known to work) while the player reads the start screen;
// instantiated (streaming) once they click. A failure surfaces when they are awaited.
let glue, wasm;
function prefetch() {
  glue = import("./horizon.js");
  wasm = fetch(new URL("horizon_bg.wasm", import.meta.url));
  glue.catch(() => {});
  wasm.catch(() => {});
}

async function webgpu() {
  if (!window.isSecureContext) {
    return "WebGPU needs a secure context: open the game over https or from localhost.";
  }
  if (!navigator.gpu) {
    return "This browser has no WebGPU. Use a current Chrome or Edge (113+), Firefox 141+ on Windows, or Safari 26+; on Linux, Chrome needs --enable-unsafe-webgpu.";
  }
  try {
    if (!(await navigator.gpu.requestAdapter())) {
      return "WebGPU is present but found no GPU adapter (it may be blocklisted for this GPU or driver; see chrome://gpu).";
    }
  } catch (e) {
    return `WebGPU failed to find an adapter: ${e}`;
  }
  return null;
}

// A panic ends in a trap after console_error_panic_hook has logged it; show it on the page
// too. winit throws one exception on purpose for control flow; that one is not an error.
function uncaught(error) {
  if (failed) return;
  const text = error && error.stack ? `${error}\n${error.stack}` : String(error);
  if (text.includes("Using exceptions for control flow")) return;
  fail("The game crashed. The browser console has the details.", text);
}

// Panics report through horizonError (crash.rs) and end in a wasm trap (a RuntimeError). A
// rejected browser-API promise (pointer lock refused, fullscreen, audio: a DOMException) is not
// a crash: the game hears about a refused pointer lock through `pointerlockerror`.
function fatalRejection(reason) {
  if (reason instanceof WebAssembly.RuntimeError) return true;
  if (typeof DOMException !== "undefined" && reason instanceof DOMException) return false;
  return true;
}

// Ctrl+W (sprint + forward) closes the tab, and a page can't cancel it: only a keyboard lock,
// which Chrome grants in fullscreen alone, hands such shortcuts to the page. So the click that
// starts the game goes fullscreen and locks the keyboard (again whenever the game's F11 re-enters
// fullscreen); outside fullscreen, "Leave site?" stands between a stray Ctrl+W and the world.
function guardKeys() {
  window.addEventListener("beforeunload", (e) => {
    if (failed) return;
    e.preventDefault();
    e.returnValue = "";
  });
  const lock = () => {
    if (document.fullscreenElement) navigator.keyboard?.lock?.().catch(() => {});
  };
  document.addEventListener("fullscreenchange", lock);
  document.documentElement.requestFullscreen?.().catch(() => {});
}

async function start() {
  const missing = await webgpu();
  if (missing) {
    fail("WebGPU is not available.", missing);
    return;
  }
  prefetch();
  const overlay = $("#start");
  const button = overlay.querySelector("button");
  button.textContent = "Click to play";
  button.disabled = false;
  overlay.hidden = false;
  await new Promise((resolve) => overlay.addEventListener("click", resolve, { once: true }));
  overlay.hidden = true;
  guardKeys();
  gesture();
  for (const type of ["pointerdown", "keydown"]) {
    window.addEventListener(type, gesture, { capture: true, passive: true });
  }
  window.addEventListener("error", (e) => uncaught(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => {
    if (fatalRejection(e.reason)) return uncaught(e.reason);
    console.warn("[boot] ignored unhandled rejection:", e.reason);
    e.preventDefault();
  });
  window.horizonProgress("Loading the game", 0);
  const calls = progressCalls;
  try {
    const { default: init } = await glue;
    await init({ module_or_path: wasm });
  } catch (e) {
    // Also winit's control-flow exception, when `fn main` leaves through `run_app`.
    uncaught(e);
  }
  // `fn main` has returned (its loop runs on as browser callbacks): unless the game reported
  // its own progress, the bar shown above is done.
  if (!failed && progressCalls === calls) window.horizonProgress("Loading the game", 1);
}

start().catch((e) => fail("Horizon could not start.", String(e)));
