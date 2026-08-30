import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const renderer = readFileSync(resolve(here, "../src/renderer.js"), "utf8");
const css = readFileSync(resolve(here, "../src/domestic-loading-overlay.css"), "utf8");

const renderStart = renderer.indexOf("function renderDomesticLoading");
const renderEnd = renderer.indexOf("function showDomesticSearchOverlay", renderStart);
const loaderBlock = renderer.slice(renderStart, renderEnd);

test("domestic loader renders only the approved otter raster", () => {
  assert.match(loaderBlock, /class="otter-approved-stage"/);
  assert.match(loaderBlock, /class="domestic-loading-otter otter-approved-image"/);
  assert.match(loaderBlock, /src="data:image\/webp;base64,/);
  assert.doesNotMatch(loaderBlock, /otter-employee-svg|otter-glasses|otter-ear-left|otter-ear-right/);
  assert.doesNotMatch(loaderBlock, /otter-tail-group|otter-paw-left-group|otter-paw-right-group/);
});

test("typing motion is external and never transforms the approved image", () => {
  const imageRule = css.match(/\.domestic-loading-otter\.otter-approved-image\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.doesNotMatch(imageRule, /animation\s*:/);
  assert.match(imageRule, /transform:\s*none\s*!important/);
  assert.match(imageRule, /filter:\s*none\s*!important/);
  assert.match(imageRule, /opacity:\s*1\s*!important/);
  assert.match(loaderBlock, /otter-key-flash-left/);
  assert.match(loaderBlock, /otter-key-flash-right/);
  assert.match(css, /@keyframes approved-key-flash-left/);
  assert.match(css, /@keyframes approved-key-flash-right/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none\s*!important/);
});

test("loading modal covers the viewport and exposes live progress", () => {
  assert.match(css, /\.domestic-search-overlay\s*\{[\s\S]*position:\s*fixed\s*!important/);
  assert.match(css, /\.domestic-search-overlay\s*\{[\s\S]*inset:\s*0\s*!important/);
  assert.match(css, /body:has\(> \.domestic-search-overlay:not\(\[hidden\]\)\)[\s\S]*overflow:\s*hidden\s*!important/);
  assert.match(renderer, /class="domestic-overlay-progress" role="progressbar"/);
  assert.match(renderer, /aria-valuenow="\$\{percent\}"/);
  assert.match(renderer, /class="domestic-overlay-count"/);
  assert.match(renderer, /현재 상품번호/);
  assert.match(renderer, /검색창은 백그라운드에서 작동합니다/);
});

