import { readFile } from "node:fs/promises";

const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`popular auto-fetch verification failed: ${message}`); };

if (!renderer.includes("let popularAutoCaptureStarted = false;")) fail("auto-capture state guard missing");
if (!renderer.includes("async function runPopularAutoCaptureOnce()")) fail("auto-capture function missing");
if (!renderer.includes("await capturePopularProducts();")) fail("auto-capture does not call popular workflow");
if (!renderer.includes("document.querySelector('[data-explorer=\"popular\"]')?.addEventListener(\"click\"")) fail("popular tab does not trigger auto-capture");
if (!renderer.includes("popularAutoCaptureStarted = true;\n  await capturePopularProducts();")) fail("manual retry button no longer marks capture as started");
if (!renderer.includes("popularAutoCaptureRunning")) fail("duplicate-run guard missing");

console.log("popular list automatic first-open fetch and manual retry verification passed");
