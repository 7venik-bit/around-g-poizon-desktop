import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const css = String(await readFile(new URL("../src/domestic-loading-overlay.css", import.meta.url), "utf8"));
const packageJson = String(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const gif = await readFile(new URL("../src/assets/otter-typing-tail-sway.gif", import.meta.url));
const sprite = await readFile(new URL("../src/assets/otter-typing-tail-sway-sprite.png", import.meta.url));
const still = await readFile(new URL("../src/assets/otter-typing-tail-sway-static.webp", import.meta.url));

const gifDigest = createHash("sha256").update(gif).digest("hex");
const spriteDigest = createHash("sha256").update(sprite).digest("hex");
const stillDigest = createHash("sha256").update(still).digest("hex");
if (gif.length !== 182_845 || gifDigest !== "f992c8c4dad36fcbd4b123a5e8bde59d0ba139585660c8c1f5e22f83543895ff") {
  throw new Error(`approved multi-frame GIF mismatch: ${gif.length} bytes, ${gifDigest}`);
}
if (sprite.length !== 119_700 || spriteDigest !== "ceff65ea01b35b6cb948f5cc69197c5e45c17aa6178328210fae00287f5702ba") {
  throw new Error(`single-tail sprite mismatch: ${sprite.length} bytes, ${spriteDigest}`);
}
if (still.length !== 28_892 || stillDigest !== "96a7d4a664aab4c7e42c55410f5a955926430930540d43b6103224930660b4fc") {
  throw new Error(`approved reduced-motion still mismatch: ${still.length} bytes, ${stillDigest}`);
}
if (gif.subarray(0, 6).toString("ascii") !== "GIF89a") {
  throw new Error("approved otter asset is not an animated GIF");
}
if (gif.readUInt16LE(6) !== 500 || gif.readUInt16LE(8) !== 344) {
  throw new Error("approved otter GIF dimensions must remain 500x344");
}
let transparentFrameCount = 0;
for (let index = 0; index <= gif.length - 8; index += 1) {
  if (gif[index] === 0x21 && gif[index + 1] === 0xf9 && gif[index + 2] === 0x04) {
    if ((gif[index + 3] & 0x01) === 0x01) transparentFrameCount += 1;
  }
}
if (transparentFrameCount !== 5) {
  throw new Error(`all five otter GIF frames must carry transparency; found ${transparentFrameCount}`);
}

const renderStart = renderer.indexOf("function renderDomesticLoading");
const renderEnd = renderer.indexOf("function showDomesticSearchOverlay", renderStart);
const loader = renderer.slice(renderStart, renderEnd);
for (const token of [
  'class="otter-approved-stage"',
  'class="domestic-loading-otter otter-single-tail-sprite"',
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

if (!css.includes(".domestic-loading-otter.otter-single-tail-sprite")) {
  throw new Error("single-tail sprite layout rule is missing");
}
if (!/\.domestic-loading-otter\.otter-single-tail-sprite,[\s\S]*?background:\s*transparent\s*!important/.test(css)) {
  throw new Error("otter image stage must remain transparent");
}
if (!/background-size:\s*500% 100%\s*!important/.test(css) || !/@keyframes otter-single-tail-frames/.test(css)) {
  throw new Error("five-frame single-tail sprite animation is missing");
}
if (/approved-otter-paw-tap|clip-path:\s*ellipse|otter-typing-paw-layer/.test(css)) {
  throw new Error("legacy cropped-paw animation CSS is still present");
}
if (!/@media \(prefers-reduced-motion: reduce\)[\s\S]*otter-single-tail-sprite[\s\S]*display:\s*none\s*!important[\s\S]*otter-multiframe-static[\s\S]*display:\s*block\s*!important/.test(css)) {
  throw new Error("reduced-motion static mascot fallback is missing");
}
if (packageJson.includes("patch-otter-typing-animation.mjs")) {
  throw new Error("postinstall still mutates the otter renderer");
}

console.log(`single-tail otter sprite verified with typing and tail sway (${spriteDigest})`);
