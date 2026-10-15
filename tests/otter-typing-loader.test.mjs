import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const renderer = readFileSync(resolve(here, "../src/renderer.js"), "utf8");
const css = readFileSync(resolve(here, "../src/domestic-loading-overlay.css"), "utf8");
const sprite = readFileSync(resolve(here, "../src/assets/otter-typing-tail-sway-sprite.png"));

const renderStart = renderer.indexOf("function renderDomesticLoading");
const renderEnd = renderer.indexOf("function showDomesticSearchOverlay", renderStart);
const loaderBlock = renderer.slice(renderStart, renderEnd);

test("domestic loader renders the approved single-tail otter sprite", () => {
  assert.match(loaderBlock, /class="otter-approved-stage"/);
  assert.match(loaderBlock, /class="domestic-loading-otter otter-single-tail-sprite"/);
  assert.equal(sprite.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(sprite.readUInt32BE(16), 2500);
  assert.equal(sprite.readUInt32BE(20), 344);
  assert.doesNotMatch(loaderBlock, /APPROVED_OTTER_IMAGE_SRC|data:image\/webp;base64/);
  assert.doesNotMatch(loaderBlock, /otter-typing-paw-layer|otter-key-flash/);
});

test("typing motion advances all five artifact-free sprite frames without a cropped overlay", () => {
  const stageRule = css.match(/\.otter-approved-stage\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.doesNotMatch(stageRule, /animation\s*:/);
  assert.match(stageRule, /transform:\s*none/);
  assert.doesNotMatch(css, /clip-path:\s*ellipse|approved-otter-paw-tap|otter-typing-paw-layer/);
  assert.match(css, /background-size:\s*500% 100%\s*!important/);
  assert.match(css, /@keyframes otter-single-tail-frames/);
  assert.match(css, /23\.33%, 39\.99% \{ background-position: 25% 0; \}/);
  assert.match(css, /76\.67%, 100% \{ background-position: 100% 0; \}/);
  assert.doesNotMatch(css, /\.domestic-loading-otter\.otter-single-tail-sprite\s*\{[^}]*background:\s*transparent\s*!important/);
});

test("search runs background-only without overlay markup", () => {
  assert.doesNotMatch(renderer, /domestic-search-overlay-card/);
  assert.doesNotMatch(renderer, /domestic-overlay-stop/);
  assert.doesNotMatch(renderer, /domestic-overlay-guide/);
  assert.match(renderer, /function stopExcelPreviewSearch\(\)/);
});
