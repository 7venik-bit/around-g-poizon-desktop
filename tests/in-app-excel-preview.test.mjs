import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, rendererSource, htmlSource, cssSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
]);

test("Excel preview is read-only and paginated in the main sourcing screen", () => {
  assert.match(mainSource, /import \{ readFirstDataSheet \} from "\.\/services\/excel-reader\.mjs"/);
  assert.match(mainSource, /async function previewExcelFile/);
  assert.match(mainSource, /filtered\.entries\.slice\(offset, offset \+ limit\)/);
  assert.match(mainSource, /Math\.min\(200, Math\.max\(25,/);
  assert.match(rendererSource, /async function showExcelPreview/);
  assert.match(rendererSource, /previewExcelFile\(file\.path, offset, 100, filters\)/);
  assert.match(rendererSource, /excel-preview-prev/);
  assert.match(rendererSource, /excel-preview-next/);
  assert.match(htmlSource, /읽기 전용|IN-APP EXCEL VIEWER/);
  assert.match(cssSource, /\.excel-preview-grid\{max-height:560px;overflow:auto/);
  assert.match(cssSource, /position:sticky;top:0/);
  assert.match(rendererSource, /Number\.isFinite\(Number\(result\.totalColumns\)\)/);
});

test("Excel preview filters both total-sales columns across all rows", async () => {
  const preloadSource = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
  assert.match(htmlSource, /id="excel-filter-min-total"[^>]+value="50"/);
  assert.match(htmlSource, /id="excel-filter-min-local-total"[^>]+value="50"/);
  assert.match(htmlSource, /id="excel-filter-match"/);
  assert.match(htmlSource, /id="excel-filter-apply"/);
  assert.match(htmlSource, /id="excel-filter-reset"/);
  assert.match(mainSource, /filterPoizonPreviewRows\(workbook\.headers, workbook\.rows, input\.filters/);
  assert.match(mainSource, /rowNumbers: pageEntries\.map/);
  assert.match(rendererSource, /activeExcelPreview\.filters/);
  assert.match(rendererSource, /필터 결과/);
  assert.match(preloadSource, /previewExcelFile: \(path, offset = 0, limit = 100, filters = \{\}\)/);
});

test("brand Excel preview supports popular-list style product selection", () => {
  assert.match(htmlSource, /id="excel-preview-select-page"/);
  assert.match(htmlSource, /id="excel-preview-selected-count"/);
  assert.match(htmlSource, /id="excel-preview-selection-clear"/);
  assert.match(rendererSource, /const selectedExcelPreviewProducts = new Set\(\)/);
  assert.match(rendererSource, /function excelPreviewProductKey/);
  assert.match(rendererSource, /data-excel-product-select/);
  assert.match(rendererSource, /updateExcelPreviewSelectionUi\(pageProductKeys\)/);
  assert.match(cssSource, /\.excel-preview-selection/);
  assert.match(cssSource, /\.excel-product-select-column/);
});

test("shared Excel reader repairs POIZON A1 dimensions before preview and ordinary import", async () => {
  const readerSource = await readFile(new URL("../services/excel-reader.mjs", import.meta.url), "utf8");
  assert.match(readerSource, /repairPoizonWorksheetDimensions\(input\)/);
  assert.match(readerSource, /readSheet\(workbookInput, 1\)/);
  assert.match(readerSource, /readXlsxFile\(workbookInput\)/);
  assert.equal((mainSource.match(/readFirstDataSheet\(await readFile\(filePath\)\)/g) || []).length, 2);
});

test("downloaded file rows open the embedded preview without launching Windows Excel", () => {
  const clickStart = rendererSource.indexOf('$("#brand-download-files").addEventListener("click"');
  const clickEnd = rendererSource.indexOf('$("#brand-download-clear")', clickStart);
  const clickWorkflow = rendererSource.slice(clickStart, clickEnd);

  assert.match(rendererSource, /data-open-brand-file-index/);
  assert.match(rendererSource, /프로그램에서 보기/);
  assert.match(clickWorkflow, /showExcelPreview\(file, 0\)/);
  assert.doesNotMatch(clickWorkflow, /openOriginalExcelFile|shell\.openPath/);
});

test("successful original downloads use the concise confirmation label", () => {
  assert.match(rendererSource, /POIZON 원본 · 확인완료/);
  assert.match(rendererSource, /updateBrandExportJob\(file\?\.jobId, "확인완료"/);
  assert.doesNotMatch(rendererSource, /100% 검증완료/);
});
