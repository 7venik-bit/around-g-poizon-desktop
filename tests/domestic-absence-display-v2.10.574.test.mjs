import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("compact sourcing rows show confirmed empty Naver and official-mall sources as 상품 없음", async () => {
  const source = await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8");
  assert.match(source, /const message = source\?\.absenceConfirmed === true\s*\? "상품 없음"/);
  assert.match(source, /source\?\.resultLinkOnly === true \|\| Number\(source\?\.count \|\| 0\) > 0\s*\|\| source\?\.absenceConfirmed === true/);
});

test("detailed source-only rows label a confirmed empty result as 상품 없음", async () => {
  const source = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  assert.match(source, /const sourceResultLabel = status\.className === "missing" \? "상품 없음" : "검색 결과"/);
  assert.match(source, /domestic-result-product"><b>\$\{sourceResultLabel\}<\/b>/);
});
