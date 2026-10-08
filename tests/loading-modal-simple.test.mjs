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

test("progress loader carries no mascot", () => {
  assert.doesNotMatch(loaderBlock, /otter-approved-stage/);
  assert.doesNotMatch(loaderBlock, /domestic-loading-otter/);
  assert.doesNotMatch(css, /otter-approved-stage/);
  assert.doesNotMatch(css, /otter-single-tail/);
  assert.doesNotMatch(css, /otter-typing-tail-sway-sprite/);
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
  assert.match(renderer, /상품을 확인하고 있습니다/);
  assert.doesNotMatch(renderer, /검색창은 백그라운드에서 작동합니다/);
});
