import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const layout = await readFile(new URL("../src/excel-column-layout.js", import.meta.url), "utf8");

test("brand selection first screen keeps every verified product column visible", () => {
  const renderStart = renderer.indexOf("function renderVerifiedSpuRows(");
  const renderEnd = renderer.indexOf("function mergeDomesticSearchProducts(", renderStart);
  const verified = renderer.slice(renderStart, renderEnd);
  const resetStart = layout.indexOf("function resetProductViewColumns(");
  const resetEnd = layout.indexOf("async function loadLayout(", resetStart);
  const reset = layout.slice(resetStart, resetEnd);

  for (const heading of ["상품번호 · SPU", "상품명 · 사이즈 펼치기", "브랜드", "상품 최근 30일 평균 거래가", "중국 상품 최근 30일", "현지 상품 최근 30일", "검증", "상품 검색 결과"]) {
    assert.match(verified, new RegExp(heading.replace(/[·]/g, "·")));
  }
  assert.match(reset, /querySelectorAll\("#excel-preview-columns th, #excel-preview-rows td"\)/);
  assert.match(reset, /classList\.remove\("excel-column-hidden"\)/);
  assert.match(layout, /if \(preview\?\.viewMode === "products"\) \{\s*resetProductViewColumns\(\)/);
});
