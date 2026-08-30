import { readFile } from "node:fs/promises";

const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const css = String(await readFile(new URL("../src/domestic-loading-overlay.css", import.meta.url), "utf8"));

const requiredRenderer = [
  'class="domestic-loading-otter otter-employee-svg"',
  'class="otter-tail-group"',
  'class="otter-whiskers"',
  'class="otter-paw-left-group"',
  'class="otter-paw-right-group"',
  'class="otter-typing-tick otter-typing-tick-left"',
  'class="otter-typing-tick otter-typing-tick-right"',
];
for (const token of requiredRenderer) {
  if (!renderer.includes(token)) throw new Error(`missing otter renderer token: ${token}`);
}

const forbiddenRenderer = ["otter-glasses", "otter-ear-left", "otter-ear-right"];
for (const token of forbiddenRenderer) {
  const renderStart = renderer.indexOf("function renderDomesticLoading");
  const renderEnd = renderer.indexOf("function showDomesticSearchOverlay", renderStart);
  const block = renderer.slice(renderStart, renderEnd);
  if (block.includes(token)) throw new Error(`legacy mascot token still rendered: ${token}`);
}

const requiredCss = [
  ".otter-employee-svg",
  ".otter-paw-left-group",
  ".otter-paw-right-group",
  "@keyframes otter-type-left",
  "@keyframes otter-type-right",
  "@keyframes otter-tail-sway",
  ".otter-typing-tick-left",
  ".otter-typing-tick-right",
];
for (const token of requiredCss) {
  if (!css.includes(token)) throw new Error(`missing otter animation CSS token: ${token}`);
}

console.log("otter typing loader verified");
