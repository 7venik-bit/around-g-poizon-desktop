import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const renderer = readFileSync(resolve(here, "../src/renderer.js"), "utf8");
const css = readFileSync(resolve(here, "../src/domestic-loading-overlay.css"), "utf8");

test("domestic loader renders the new otter SVG instead of legacy bear-like parts", () => {
  const start = renderer.indexOf("function renderDomesticLoading");
  const end = renderer.indexOf("function showDomesticSearchOverlay", start);
  const block = renderer.slice(start, end);
  assert.match(block, /domestic-loading-otter otter-employee-svg/);
  assert.match(block, /otter-tail-group/);
  assert.match(block, /otter-whiskers/);
  assert.doesNotMatch(block, /otter-glasses/);
  assert.doesNotMatch(block, /otter-ear-left/);
  assert.doesNotMatch(block, /otter-ear-right/);
});

test("otter paws alternate over the keyboard and tail moves", () => {
  assert.match(css, /@keyframes otter-type-left/);
  assert.match(css, /@keyframes otter-type-right/);
  assert.match(css, /@keyframes otter-tail-sway/);
  assert.match(css, /\.otter-paw-left-group[\s\S]*animation:\s*otter-type-left/);
  assert.match(css, /\.otter-paw-right-group[\s\S]*animation:\s*otter-type-right/);
  assert.match(css, /\.otter-typing-tick-left/);
  assert.match(css, /\.otter-typing-tick-right/);
});

test("loading modal keeps enough space so title cannot overlap mascot", () => {
  assert.match(css, /\.domestic-search-overlay \.domestic-search-loading[\s\S]*min-height:\s*285px/);
  assert.match(css, /\.domestic-search-overlay \.domestic-loading-otter\.otter-employee-svg[\s\S]*height:\s*170px/);
  assert.match(css, /content:\s*"국내 판매처 검색 중"/);
});
