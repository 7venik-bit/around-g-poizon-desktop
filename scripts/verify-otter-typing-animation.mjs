import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const css = String(await readFile(new URL("../src/domestic-loading-overlay.css", import.meta.url), "utf8"));
const packageJson = String(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const gif = await readFile(new URL("../src/assets/otter-typing-tail-sway.gif", import.meta.url));
const still = await readFile(new URL("../src/assets/otter-typing-tail-sway-static.webp", import.meta.url));

const gifDigest = createHash("sha256").update(gif).digest("hex");
const stillDigest = createHash("sha256").update(still).digest("hex");
if (gif.length !== 167_486 || gifDigest !== "16d29c5f36e1373206508ac00a42cdfdeace826b88a03a6be6160dd5ac32edfc") {
  throw new Error(`approved multi-frame GIF mismatch: ${gif.length} bytes, ${gifDigest}`);
}
if (still.length !== 8_240 || stillDigest !== "c871b7612f389857a5791efe0651f0613941e7fb4babbd50ff24fe8cb501cb1b") {
  throw new Error(`approved reduced-motion still mismatch: ${still.length} bytes, ${stillDigest}`);
}
if (gif.subarray(0, 6).toString("ascii") !== "GIF89a") {
  throw new Error("approved otter asset is not an animated GIF");
}
if (gif.readUInt16LE(6) !== 500 || gif.readUInt16LE(8) !== 344) {
  throw new Error("approved otter GIF dimensions must remain 500x344");
}

const renderStart = renderer.indexOf("function renderDomesticLoading");
const renderEnd = renderer.indexOf("function showDomesticSearchOverlay", renderStart);
const loader = renderer.slice(renderStart, renderEnd);
for (const token of [
  'class="otter-approved-stage"',
  'class="domestic-loading-otter otter-multiframe-gif"',
  'src="./assets/otter-typing-tail-sway.gif"',
  'class="domestic-loading-otter otter-multiframe-static"',
  'src="./assets/otter-typing-tail-sway-static.webp"',
]) {
  if (!loader.includes(token)) throw new Error(`missing multi-frame otter renderer token: ${token}`);
}
for (const forbidden of [
  "APPROVED_OTTER_IMAGE_SRC",
  "otter-typing-paw-layer",
  "otter-key-flash",
  "data:image/webp;base64,",
  "otter-ear-left",
  "otter-paw-left",
]) {
  if (loader.includes(forbidden)) throw new Error(`legacy layered otter token still rendered: ${forbidden}`);
}

if (!css.includes(".domestic-loading-otter.otter-multiframe-gif")) {
  throw new Error("multi-frame GIF layout rule is missing");
}
if (/approved-otter-paw-tap|clip-path:\s*ellipse|otter-typing-paw-layer/.test(css)) {
  throw new Error("legacy cropped-paw animation CSS is still present");
}
if (!/@media \(prefers-reduced-motion: reduce\)[\s\S]*otter-multiframe-gif[\s\S]*display:\s*none\s*!important[\s\S]*otter-multiframe-static[\s\S]*display:\s*block\s*!important/.test(css)) {
  throw new Error("reduced-motion static mascot fallback is missing");
}
if (packageJson.includes("patch-otter-typing-animation.mjs")) {
  throw new Error("postinstall still mutates the otter renderer");
}

console.log(`real multi-frame otter GIF verified with typing and tail sway (${gifDigest})`);
