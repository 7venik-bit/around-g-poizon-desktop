import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("브랜드몰은 생성형 클래스나 일반 URL이어도 이미지와 가격이 있는 상품 카드를 추출한다", () => {
  assert.match(main, /const roots = \[document\]/);
  assert.match(main, /element\.shadowRoot/);
  assert.match(main, /const structuralCardLinks = allLinks\.filter/);
  assert.match(main, /image && price && text\.length >= 5/);
  assert.match(main, /\.\.\.structuralCardLinks/);
});
