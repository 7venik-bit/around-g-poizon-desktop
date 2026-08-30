import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const css = String(await readFile(new URL("../src/domestic-loading-overlay.css", import.meta.url), "utf8"));
const patch = String(await readFile(new URL("./patch-otter-typing-animation.mjs", import.meta.url), "utf8"));
const chunkNames = [
  "part-00-full.txt",
  "part-02.txt",
  "part-03.txt",
  "part-04.txt",
  "part-05.txt",
];
const imageBase64 = (await Promise.all(chunkNames.map((name) =>
  readFile(new URL(`./otter-image-chunks/${name}`, import.meta.url), "utf8")
))).join("").replace(/\s+/g, "");

const expectedLength = 85_704;
const expectedDigest = "35647819f16063f8bfba099dfcdcc2008803e070a14e5b682414126815252c7f";
if (imageBase64.length !== expectedLength) {
  throw new Error(`approved otter base64 length mismatch: ${imageBase64.length}`);
}
const digest = createHash("sha256").update(Buffer.from(imageBase64, "base64")).digest("hex");
if (digest !== expectedDigest) {
  throw new Error(`approved otter image digest mismatch: ${digest}`);
}
if (!patch.includes("85_704") || !patch.includes(expectedDigest)) {
  throw new Error("patch script is not pinned to the exact approved otter raster");
}

const renderStart = renderer.indexOf("function renderDomesticLoading");
const renderEnd = renderer.indexOf("function showDomesticSearchOverlay", renderStart);
const block = renderer.slice(renderStart, renderEnd);

const requiredRenderer = [
  'class="otter-approved-stage"',
  'class="domestic-loading-otter otter-approved-image"',
  'data:image/webp;base64,',
  'class="otter-key-flash otter-key-flash-left"',
  'class="otter-key-flash otter-key-flash-right"',
  imageBase64.slice(0, 80),
  imageBase64.slice(-80),
];
for (const token of requiredRenderer) {
  if (!block.includes(token)) throw new Error(`missing approved otter renderer token: ${token.slice(0, 80)}`);
}

const forbiddenRenderer = [
  "otter-employee-svg",
  "otter-glasses",
  "otter-ear-left",
  "otter-ear-right",
  "otter-tail-group",
  "otter-paw-left-group",
  "otter-paw-right-group",
];
for (const token of forbiddenRenderer) {
  if (block.includes(token)) throw new Error(`redrawn/legacy mascot token still rendered: ${token}`);
}

const requiredCss = [
  ".otter-approved-stage",
  ".domestic-loading-otter.otter-approved-image",
  "transform: none !important",
  "filter: none !important",
  "opacity: 1 !important",
  ".otter-key-flash-left",
  ".otter-key-flash-right",
  "@keyframes approved-otter-typing-bob",
  "@keyframes approved-key-flash-left",
  "@keyframes approved-key-flash-right",
];
for (const token of requiredCss) {
  if (!css.includes(token)) throw new Error(`missing approved otter CSS token: ${token}`);
}

const imageRule = css.match(/\.domestic-loading-otter\.otter-approved-image\s*\{([\s\S]*?)\}/)?.[1] || "";
const stageRule = css.match(/\.otter-approved-stage\s*\{([\s\S]*?)\}/)?.[1] || "";
if (/animation\s*:/.test(imageRule)) throw new Error("approved otter image must not be animated directly");
if (!/transform:\s*none\s*!important/.test(imageRule)) throw new Error("approved otter image transform must stay disabled");
if (!/filter:\s*none\s*!important/.test(imageRule)) throw new Error("approved otter image filters must stay disabled");
if (!/animation:\s*approved-otter-typing-bob/.test(stageRule)) {
  throw new Error("approved otter stage movement is missing");
}
if (!/transform-origin:\s*50% 82%/.test(stageRule)) {
  throw new Error("approved otter stage movement origin is missing");
}
if (/rotate\(/.test(stageRule) || /rotate\(/.test(css.match(/@keyframes approved-otter-typing-bob\s*\{([\s\S]*?)\n\}/)?.[1] || "")) {
  throw new Error("approved otter movement must not rock or rotate");
}
if (!/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.otter-approved-stage[\s\S]*animation:\s*none\s*!important/.test(css)) {
  throw new Error("reduced-motion fallback for approved otter stage is missing");
}

console.log(`exact approved otter raster verified unchanged with stage movement (${digest}, ${imageBase64.length} base64 chars)`);
