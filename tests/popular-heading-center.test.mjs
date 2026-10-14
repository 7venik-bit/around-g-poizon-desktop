import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");

test("popular panel has no heading above the workflow", () => {
  assert.match(html, /id="explorer-popular"/);
  assert.doesNotMatch(html, /판매자센터 인기상품 자동 검색/);
  assert.doesNotMatch(html, /MERCHANT RANK BOARD/);
});
