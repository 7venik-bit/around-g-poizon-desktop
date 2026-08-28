import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/excel-column-layout.js", import.meta.url), "utf8");

test("integrated raw Excel defaults to sourcing-only columns", () => {
  assert.match(source, /preview\?\.viewMode === "raw"/);
  assert.match(source, /Boolean\(excelPreviewIntegrated\)/);
  assert.match(source, /localStorage\.getItem\(COLUMN_MODE_KEY\) !== "all"/);
  assert.match(source, /if \(integratedRawView && compactMode\)/);
  assert.match(source, /applySourcingColumns\(false\)/);
  assert.match(source, /불필요 열을 자동으로 숨겼습니다/);
});

test("sourcing view keeps identity, image, price, sales and link-adjacent data", () => {
  assert.match(source, /spu이미지/);
  assert.match(source, /상품번호/);
  assert.match(source, /상품명/);
  assert.match(source, /사이즈/);
  assert.match(source, /평균거래가/);
  assert.match(source, /현재중국최저입찰가예상수익/);
  assert.match(source, /중국총판매량/);
  assert.match(source, /현지판매자총판매량/);
  assert.match(source, /const hidden = !sourcingEssentialColumn\(header\)/);
  assert.match(source, /localStorage\.setItem\(COLUMN_MODE_KEY, "all"\)/);
  assert.match(source, /localStorage\.setItem\(COLUMN_MODE_KEY, "compact"\)/);
});

test("raw data indexing excludes selection and the final domestic-search result cell", () => {
  assert.match(source, /querySelectorAll\("#excel-preview-columns \.excel-raw-data-heading"\)/);
  assert.match(source, /querySelectorAll\("\.excel-raw-data-cell"\)/);
});
