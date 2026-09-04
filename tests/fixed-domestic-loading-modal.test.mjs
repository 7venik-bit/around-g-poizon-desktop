import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const overlayCss = readFileSync(resolve(here, "../src/domestic-loading-overlay.css"), "utf8");
const layoutCss = readFileSync(resolve(here, "../src/excel-column-layout.css"), "utf8");

test("domestic search progress is a fixed viewport modal that locks page scrolling", () => {
  assert.match(layoutCss, /@import url\("\.\/domestic-loading-overlay\.css"\);/);
  assert.match(overlayCss, /\.domestic-search-overlay\s*\{[\s\S]*?position:\s*fixed\s*!important;/);
  assert.match(overlayCss, /\.domestic-search-overlay\s*\{[\s\S]*?inset:\s*0\s*!important;/);
  assert.match(overlayCss, /html:has\(body > \.domestic-search-overlay:not\(\[hidden\]\)\)[\s\S]*?overflow:\s*hidden\s*!important;/);
  assert.match(overlayCss, /width:\s*auto\s*!important;/);
  assert.match(overlayCss, /height:\s*auto\s*!important;/);
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
