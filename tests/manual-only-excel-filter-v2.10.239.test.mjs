import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

test("opening product search never applies an automatic sales threshold", () => {
  const start = renderer.indexOf("async function openIntegratedBrandExcel");
  const end = renderer.indexOf('$("#brand-export-completed-list")', start);
  const source = renderer.slice(start, end);
  assert.match(source, /const minimum = ""/);
  assert.match(source, /excel-filter-min-total"\)\.value = ""/);
  assert.match(source, /excel-filter-min-local-total"\)\.value = ""/);
  assert.doesNotMatch(source, /productSearch \? "30"/);
  assert.match(source, /preserveFilters: false/);
});

test("sales filtering remains a manual button action", () => {
  assert.match(renderer, /excel-filter-apply"[\s\S]*showExcelPreview\(activeExcelPreview\.file, 0, currentExcelPreviewFilters\(\)\)/);
  assert.match(renderer, /필터 미적용 · 원본 전체/);
  assert.match(renderer, /수동 필터 적용 · 원본/);
  assert.match(renderer, /판매량 필터를 사용하지 않고 전체/);
});
