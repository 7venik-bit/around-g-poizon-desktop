import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("whole-list search ignores current display filters", () => {
  assert.match(renderer, /sourceTotalRows/);
  assert.match(renderer, /원본 전체 검색/);
  assert.match(renderer, /minimumTotal: ""/);
  assert.match(renderer, /minimumLocalTotal: ""/);
});

test("multi-selection groups duplicate articles but applies results to every selected row", () => {
  assert.match(renderer, /const groups = new Map\(\)/);
  assert.match(renderer, /productCrossCheckIdentity\(product\)/);
  assert.match(renderer, /for \(const key of groupKeys\) excelPreviewSearchResults\.set\(key, result\)/);
  assert.match(renderer, /await refreshVisibleRows\(\)/);
});
