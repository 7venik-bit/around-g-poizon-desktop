import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const overlayCss = readFileSync(resolve(here, "../src/domestic-loading-overlay.css"), "utf8");
const layoutCss = readFileSync(resolve(here, "../src/excel-column-layout.css"), "utf8");
const renderer = readFileSync(resolve(here, "../src/renderer.js"), "utf8");
const inlineResultsCss = readFileSync(resolve(here, "../src/domestic-inline-results.css"), "utf8");
const inlineResults = readFileSync(resolve(here, "../src/domestic-inline-results.js"), "utf8");

test("domestic search progress is a fixed viewport modal that locks page scrolling", () => {
  assert.match(layoutCss, /@import url\("\.\/domestic-loading-overlay\.css"\);/);
  assert.match(overlayCss, /\.domestic-search-overlay\s*\{[\s\S]*?position:\s*fixed\s*!important;/);
  assert.match(overlayCss, /\.domestic-search-overlay\s*\{[\s\S]*?inset:\s*0\s*!important;/);
  assert.match(overlayCss, /html:has\(body > \.domestic-search-overlay:not\(\[hidden\]\)\)[\s\S]*?overflow:\s*hidden\s*!important;/);
  assert.match(overlayCss, /width:\s*auto\s*!important;/);
  assert.match(overlayCss, /height:\s*auto\s*!important;/);
  assert.match(renderer, /overlay\.removeAttribute\("style"\)/);
  assert.doesNotMatch(renderer, /overlay\.style\.left/);
});

test("batch search keeps the otter in the full-screen overlay instead of a product cell", () => {
  assert.match(renderer, /excel-raw-search-state loading\">백그라운드 검색 중/);
  assert.match(renderer, /await refreshVisibleRows\(\);[\s\S]*showDomesticSearchOverlay\(batchStartedAt, completed, keys\.length, product\)/);
  assert.doesNotMatch(renderer, /<td class="excel-raw-search-cell">\$\{renderDomesticLoading/);
});

test("otter employee visibly types on a keyboard while search continues", () => {
  assert.match(overlayCss, /\.domestic-loading-otter\.otter-single-tail-sprite/);
  assert.match(overlayCss, /animation:\s*otter-single-tail-frames \.6s linear infinite/);
  assert.match(overlayCss, /@keyframes otter-single-tail-frames/);
  assert.doesNotMatch(overlayCss, /clip-path:\s*ellipse|otter-typing-paw-layer|approved-otter-paw-tap/);
  assert.doesNotMatch(overlayCss, /\.domestic-loading-otter\.otter-single-tail-sprite\s*\{[^}]*background:\s*transparent\s*!important/);
});

test("modal keeps the approved progress information hierarchy", () => {
  assert.match(overlayCss, /content:\s*"국내 판매처 검색 중"/);
  assert.match(overlayCss, /content:\s*"열심히 상품을 찾고 있어요…"/);
  assert.match(overlayCss, /\.domestic-overlay-progress/);
  assert.match(overlayCss, /\.domestic-overlay-current/);
  assert.match(overlayCss, /\.domestic-overlay-stop/);
});

test("domestic search elapsed time is displayed as Korean hours, minutes and seconds", () => {
  assert.match(renderer, /function elapsedKoreanDuration\(milliseconds = 0\)/);
  assert.match(renderer, /hours > 0 \? `\$\{hours\}시간`/);
  assert.match(renderer, /hours > 0 \|\| minutes > 0 \? `\$\{minutes\}분`/);
  assert.match(renderer, /elapsedKoreanDuration\(now - startedAt\)/);
});

test("verified product rows keep a compact fixed height while scrolling", () => {
  assert.match(renderer, /class="excel-product-row excel-verified-spu-row"/);
  assert.match(renderer, /class="excel-verified-image"/);
  assert.match(renderer, /class="excel-verified-image-cell"/);
  assert.match(inlineResultsCss, /\.excel-verified-spu-row\{height:66px!important\}/);
  assert.match(inlineResultsCss, /table\{height:fit-content!important;min-height:0!important;align-self:flex-start!important\}/);
  assert.match(inlineResultsCss, /\.excel-verified-image-cell>\.excel-verified-image\{display:block!important;width:40px!important;height:40px!important;max-width:40px!important;max-height:40px!important/);
  assert.match(inlineResults, /table\{width:100%!important;min-width:980px!important;table-layout:fixed!important;height:fit-content!important;min-height:0!important;align-self:flex-start!important\}/);
});
