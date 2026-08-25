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

test("sourcing product table shows size, size sales and stock instead of category", () => {
  assert.match(sourcingView, /<th>사이즈<\/th>/);
  assert.match(sourcingView, /<th>사이즈 판매량<\/th>/);
  assert.match(sourcingView, /<th>재고<\/th>/);
  assert.match(sourcingView, /product\.option/);
  assert.match(sourcingView, /판매량/);
  assert.match(sourcingView, /재고 있음/);
  assert.match(sourcingView, /품절/);
});

test("size stays neutral while stock uses soft state colors", () => {
  assert.match(sourcingView, /sourcing-size\{color:#111827/);
  assert.match(sourcingView, /sourcing-stock\.available\{background:#eef7f0;color:#4f7d57/);
  assert.match(sourcingView, /sourcing-stock\.pending\{background:#fff7ed;color:#ad6b31/);
  assert.match(sourcingView, /sourcing-stock\.soldout\{background:#f3f4f6;color:#7b8794/);
});

test("preload injects the sourcing view script", () => {
  assert.match(preload, /\.\/sourcing-view\.js/);
  assert.match(preload, /data-sourcing-view/);
});
