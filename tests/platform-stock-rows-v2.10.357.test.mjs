import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const style = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("every domestic source owns a Musinsa-style stock and size section", () => {
  assert.match(renderer, /sources\.map\(\(source\) =>/);
  assert.match(renderer, /matchedProducts\.map\(\(product\) => renderProductRow/);
  assert.match(renderer, /재고·사이즈 상세 수집이 필요합니다/);
  assert.match(renderer, /검색·재고 확인/);
  assert.match(renderer, /판매처 열기/);
});

test("official, Naver, SSG, Lotte and Kolon no longer collapse into tiny source buttons", () => {
  assert.match(renderer, /domestic-source-section/);
  assert.match(renderer, /source-platform-action/);
  assert.doesNotMatch(renderer, /const directLinks =/);
  assert.match(style, /\.domestic-source-list/);
  assert.match(style, /\.domestic-source-empty/);
});
