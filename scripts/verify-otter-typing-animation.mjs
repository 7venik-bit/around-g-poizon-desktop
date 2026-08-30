import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const css = String(await readFile(new URL("../src/domestic-loading-overlay.css", import.meta.url), "utf8"));
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

if (imageBase64.length !== 78_872) {
  throw new Error(`approved otter base64 length mismatch: ${imageBase64.length}`);
}
const digest = createHash("sha256").update(Buffer.from(imageBase64, "base64")).digest("hex");
if (digest !== "b181b389bb85a83fa2c48bf5aec6dda45ff0be5ed4a6c9cfaaf55d3c4a830cba") {
  throw new Error(`approved otter image digest mismatch: ${digest}`);
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
  ".otter-key-flash-left",
  ".otter-key-flash-right",
  "@keyframes approved-key-flash-left",
  "@keyframes approved-key-flash-right",
];
for (const token of requiredCss) {
  if (!css.includes(token)) throw new Error(`missing approved otter CSS token: ${token}`);
}

console.log(`approved otter image verified unchanged (${digest.slice(0, 12)}..., ${imageBase64.length} base64 chars)`);
