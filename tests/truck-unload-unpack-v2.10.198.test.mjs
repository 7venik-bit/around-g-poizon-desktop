import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, renderer] = await Promise.all([
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);

test("category loading keeps progress information without warehouse effects", () => {
  assert.doesNotMatch(html, /delivery-truck|courier-worker|receiver-worker|sorting-conveyor|brand-scanner|product-card/);
  assert.match(html, /카테고리 검색을 준비하는 중/);
  assert.doesNotMatch(renderer, /category-courier|category-receiver|category-brand-box|category-completed-boxes/);
});
