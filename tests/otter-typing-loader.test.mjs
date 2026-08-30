import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const renderer = readFileSync(resolve(here, "../src/renderer.js"), "utf8");
const css = readFileSync(resolve(here, "../src/domestic-loading-overlay.css"), "utf8");
const gif = readFileSync(resolve(here, "../src/assets/otter-typing-tail-sway.gif"));

const renderStart = renderer.indexOf("function renderDomesticLoading");
const renderEnd = renderer.indexOf("function showDomesticSearchOverlay", renderStart);
const loaderBlock = renderer.slice(renderStart, renderEnd);

test("domestic loader renders the approved multi-frame otter GIF", () => {
  assert.match(loaderBlock, /class="otter-approved-stage"/);
  assert.match(loaderBlock, /class="domestic-loading-otter otter-multiframe-gif"/);
  assert.match(loaderBlock, /src="\.\/assets\/otter-typing-tail-sway\.gif"/);
  assert.match(loaderBlock, /class="domestic-loading-otter otter-multiframe-static"/);
  assert.match(loaderBlock, /src="\.\/assets\/otter-typing-tail-sway-static\.webp"/);
  assert.equal(gif.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.equal(gif.readUInt16LE(6), 500);
  assert.equal(gif.readUInt16LE(8), 344);
  assert.doesNotMatch(loaderBlock, /APPROVED_OTTER_IMAGE_SRC|data:image\/webp;base64/);
  assert.doesNotMatch(loaderBlock, /otter-typing-paw-layer|otter-key-flash/);
});

test("typing and tail motion come from complete GIF frames without a cropped overlay", () => {
  const stageRule = css.match(/\.otter-approved-stage\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.doesNotMatch(stageRule, /animation\s*:/);
  assert.match(stageRule, /transform:\s*none/);
  assert.doesNotMatch(css, /clip-path:\s*ellipse|approved-otter-paw-tap|otter-typing-paw-layer/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*otter-multiframe-gif[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*otter-multiframe-static[\s\S]*display:\s*block\s*!important/);
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
