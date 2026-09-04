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

test("typing and tail motion advance all five sprite frames without a cropped overlay", () => {
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

test("loading modal covers the viewport and exposes live progress", () => {
  assert.match(css, /\.domestic-search-overlay\s*\{[\s\S]*position:\s*fixed\s*!important/);
  assert.match(css, /\.domestic-search-overlay\s*\{[\s\S]*inset:\s*0\s*!important/);
  assert.match(css, /body:has\(> \.domestic-search-overlay:not\(\[hidden\]\)\)[\s\S]*overflow:\s*hidden\s*!important/);
  assert.match(renderer, /<progress class="domestic-overlay-progress" max="100" value="\$\{percent\}"/);
  assert.match(renderer, /aria-valuenow="\$\{percent\}"/);
  assert.doesNotMatch(renderer, /domestic-overlay-progress[\s\S]{0,180}style="width:/);
  assert.match(css, /\.domestic-overlay-progress::\-webkit-progress-bar/);
  assert.match(css, /\.domestic-overlay-progress::\-webkit-progress-value/);
  assert.match(renderer, /class="domestic-overlay-count"/);
  assert.match(renderer, /현재 상품번호/);
  assert.match(renderer, /검색창은 백그라운드에서 작동합니다/);
});
