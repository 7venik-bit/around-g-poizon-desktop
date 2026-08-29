import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("Excel viewer exposes one-click all-results search", () => {
  assert.match(html, /id="excel-preview-select-all-results"[^>]*>전체 목록 검색/);
  assert.match(renderer, /selectionOnly: true/);
  assert.match(renderer, /readyToSearch[^]*excel-preview-search-selected/);
  assert.match(renderer, /전체 상품 검색 중/);
});

test("selection-only preview can hydrate all filtered products without returning raw cells", () => {
  assert.match(main, /const selectionOnly = input\.filters\?\.selectionOnly === true/);
  assert.match(main, /Math\.min\(100000/);
  assert.match(main, /productView \|\| selectionOnly \? \[\]/);
});
