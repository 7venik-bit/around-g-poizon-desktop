import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourcing = await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8");

test("domestic search uses 상품 있음/상품 없음 without 확인 필요", () => {
  assert.match(sourcing, /data-around-g-domestic-binary-presence/);
  assert.match(sourcing, /label: "상품 있음"/);
  assert.match(sourcing, /label: "상품 없음"/);
  assert.doesNotMatch(sourcing, /label: "확인 필요"/);
  assert.doesNotMatch(sourcing, /검색 결과 확인이 완료되지 않았습니다\./);
  assert.doesNotMatch(sourcing, /판매처에서 직접 확인이 필요합니다\./);
});
