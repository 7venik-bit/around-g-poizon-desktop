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
  assert.doesNotMatch(htmlSource, /id="excel-filter-max-total"/);
  assert.doesNotMatch(htmlSource, /id="excel-filter-max-local-total"/);
  assert.doesNotMatch(rendererSource, /#excel-filter-max-total|#excel-filter-max-local-total/);
  assert.match(htmlSource, /id="excel-filter-match"/);
  assert.match(htmlSource, /<span>필터 조건<\/span><select id="excel-filter-match"/);
  assert.match(htmlSource, /id="excel-filter-apply"/);
  assert.match(htmlSource, /id="excel-filter-reset"/);
  assert.match(mainSource, /filterPoizonPreviewRows\(workbook\.headers, workbook\.rows, input\.filters/);
  assert.match(mainSource, /rowNumbers: productView \? \[\] : pageEntries\.map/);
  assert.match(rendererSource, /activeExcelPreview\.filters/);
  assert.match(rendererSource, /필터 결과/);
  assert.match(preloadSource, /previewExcelFile: \(path, offset = 0, limit = 100, filters = \{\}\)/);
});

test("Excel filter controls share one bottom line", () => {
  assert.match(cssSource, /\.excel-preview-filters label\{display:grid;grid-template-columns:1fr;gap:5px;align-self:stretch;margin:0/);
  assert.match(cssSource, /\.excel-preview-filters label>span\{display:flex;align-items:center;min-height:14px;line-height:14px\}/);
  assert.match(cssSource, /\.excel-preview-filters label>input,\.excel-preview-filters label>select\{width:100%\}/);
});

test("Excel defaults to a grouped product-search view with raw-data fallback", () => {
  assert.match(mainSource, /function buildExcelPreviewProducts/);
  assert.match(mainSource, /const productView = input\.filters\?\.productView !== false/);
  assert.match(mainSource, /sourceTotalProducts/);
  assert.match(htmlSource, /id="excel-view-products"[^>]*class="active"[^>]*>상품 보기/);
  assert.match(htmlSource, /id="excel-view-raw"[^>]*>원본 데이터 보기/);
  assert.match(rendererSource, /renderExcelProductRows/);
  assert.match(rendererSource, /data-excel-search-product/);
  assert.match(rendererSource, /선택 상품 일괄 검색/);
  assert.match(rendererSource, /brandName, product\.articleNumber, product\.title/);
  const productColumns = rendererSource.match(/excel-preview-columns"\)\.innerHTML = `<tr>(.*?)<\/tr>`/)?.[1] || "";
  assert.doesNotMatch(productColumns, /중국 30일|현지 30일|옵션/);
  assert.match(productColumns, /중국 총판매.*현지 총판매.*상품 검색/);
  assert.match(rendererSource, /excel-product-search-detail"><td colspan="10"/);
  assert.match(cssSource, /\.excel-preview\.product-view \.excel-preview-grid table/);
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

test("official-store verification supports every registered URL family and embedded article metadata", () => {
  assert.match(mainSource, /p\|pd\|products\?\|goods\|product/);
  assert.match(mainSource, /productDetail\\\\\.action/);
  assert.match(mainSource, /matchesExpected\(link\.href\)/);
  assert.match(mainSource, /matchesExpected\(link\.outerHTML\)/);
  assert.match(mainSource, /productCards\.push\(\{ productUrl, text, markup \}\)/);
  assert.match(mainSource, /split\("#"\)\[0\]/);
  assert.doesNotMatch(mainSource, /String\(link\.href \|\| ""\)\.split\("\?"\)/);
});

test("official-store verification failures are not shown as a confirmed zero", () => {
  assert.match(mainSource, /return null/);
  assert.match(mainSource, /pageBlocked/);
  assert.match(mainSource, /verificationFailed: !Number\.isFinite\(count\)/);
  assert.match(rendererSource, /source\.verificationFailed/);
  assert.match(rendererSource, /확인 실패/);
});

test("official store, Musinsa, and Naver sources all render numeric result badges", () => {
  assert.match(mainSource, /if \(!source\.renderCount\)/);
  assert.match(mainSource, /!source\.linkOnly && source\.ok && Number\(source\.count \|\| 0\) > 0/);
  assert.match(rendererSource, /const directLinks = \(result\.sources \|\| \[\]\)\.map/);
  assert.doesNotMatch(rendererSource, /filter\(\(source\) => source\.linkOnly\)\.map/);
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
  assert.match(rendererSource, /데이터 보기/);
  assert.match(clickWorkflow, /showExcelPreview\(file, 0\)/);
  assert.doesNotMatch(clickWorkflow, /openOriginalExcelFile|shell\.openPath/);
});

test("Excel preview replaces the file list and restores its scroll position", () => {
  assert.match(htmlSource, /id="excel-preview-close"[^>]*>← 파일 목록으로</);
  assert.match(rendererSource, /let excelFilesListScrollPosition = 0/);
  assert.match(rendererSource, /classList\.add\("excel-preview-mode"\)/);
  assert.match(rendererSource, /classList\.add\("excel-data-view-open"\)/);
  assert.match(rendererSource, /classList\.add\("excel-preview-active"\)/);
  assert.match(rendererSource, /window\.scrollTo\(\{ top: excelFilesListScrollPosition/);
  assert.match(cssSource, /\.excel-files-panel\.excel-preview-mode\{height:calc\(100vh - 166px\)/);
  assert.match(cssSource, /\.excel-files-panel\.excel-preview-mode \.excel-preview-grid\{flex:1;min-height:0;max-height:none\}/);
  assert.match(cssSource, /body\.excel-preview-active\{overflow:hidden\}/);
});

test("successful original downloads use the concise confirmation label", () => {
  assert.match(rendererSource, /POIZON 원본 · 확인완료/);
  assert.match(rendererSource, /updateBrandExportJob\(file\?\.jobId, "확인완료"/);
  assert.doesNotMatch(rendererSource, /100% 검증완료/);
});
