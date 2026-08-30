import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourcingView = await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8");
const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");

test("sourcing view removes category columns from the visible Excel workspace", () => {
  assert.match(sourcingView, /카테고리 대분류/);
  assert.match(sourcingView, /카테고리 중분류/);
  assert.match(sourcingView, /카테고리 소분류/);
  assert.match(sourcingView, /sourcing-hidden-column/);
});

test("sourcing product table shows size, sales and price comparison instead of category", () => {
  assert.match(sourcingView, /<th>사이즈<\/th>/);
  assert.match(sourcingView, /<th>사이즈 판매량<\/th>/);
  assert.match(sourcingView, /<th>POIZON 기준가<\/th>/);
  assert.match(sourcingView, /<th>국내 최저가<\/th>/);
  assert.match(sourcingView, /<th>가격 차이<\/th>/);
  assert.match(sourcingView, /<th>예상 마진율<\/th>/);
  assert.match(sourcingView, /product\.option/);
  assert.match(sourcingView, /판매량/);
});

test("size stays neutral while price gaps use clear state colors", () => {
  assert.match(sourcingView, /sourcing-size\{color:#111827/);
  assert.match(sourcingView, /sourcing-price-positive\{color:#047857/);
  assert.match(sourcingView, /sourcing-price-caution\{color:#b45309/);
  assert.match(sourcingView, /sourcing-price-negative\{color:#dc2626/);
});

test("preload injects the sourcing view script", () => {
  assert.match(preload, /\.\/sourcing-view\.js/);
  assert.match(preload, /data-sourcing-view/);
});
