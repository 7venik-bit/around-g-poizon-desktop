import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

test("menu leads with POIZON original data and downloaded Excel files", async () => {
  const html = await readFile(join(root, "src/index.html"), "utf8");

  assert.match(html, /data-view="products">POIZON 원본 데이터<\/button>/);
  assert.match(html, /data-explorer="brand"><strong>원본 데이터 가져오기<\/strong>/);
  assert.match(html, /data-explorer="files"><strong>받은 Excel 파일<\/strong>/);
  assert.match(html, /POIZON 데이터 플랫폼 화면 값<\/b>을 우선 적용/);
  assert.match(html, /Excel은 상품정보 교차 검증에 사용/);
  assert.doesNotMatch(html, /class="explorer-mode[^\"]*" data-explorer="popular"/);
  assert.doesNotMatch(html, /class="explorer-mode[^\"]*" data-explorer="category"/);
});

test("download detection registers the raw workbook without automatic sales filtering", async () => {
  const renderer = await readFile(join(root, "src/renderer.js"), "utf8");
  const start = renderer.indexOf("async function importDetectedBrandExport");
  const end = renderer.indexOf("async function drainDetectedBrandImports", start);
  const workflow = renderer.slice(start, end);

  assert.match(workflow, /path: file\.path/);
  assert.match(workflow, /name: file\.name/);
  assert.match(workflow, /확인완료/);
  assert.doesNotMatch(workflow, /importBrandExcelFromPath/);
  assert.doesNotMatch(workflow, /processedPath|processedName|filteredRows/);
});

test("file list opens the original workbook inside the sourcing program and excludes generated filtered copies", async () => {
  const [renderer, main, preload, html] = await Promise.all([
    readFile(join(root, "src/renderer.js"), "utf8"),
    readFile(join(root, "main.mjs"), "utf8"),
    readFile(join(root, "preload.cjs"), "utf8"),
    readFile(join(root, "src/index.html"), "utf8"),
  ]);

  assert.match(renderer, /previewExcelFile\(file\.path, offset, 100, filters\)/);
  assert.match(renderer, /데이터 보기/);
  assert.doesNotMatch(renderer.slice(renderer.indexOf('\$("#brand-download-files").addEventListener("click"')), /openOriginalExcelFile/);
  assert.match(preload, /previewExcelFile:.*ipcRenderer\.invoke\("excel:preview"/);
  assert.match(main, /ipcMain\.handle\("excel:preview"/);
  assert.match(html, /id="excel-preview-grid"/);
  assert.match(main, /visibleFiles = files\.filter\(\(file\) => !isProcessedBrandExportName\(file\.name\)\)/);
});

test("downloaded workbooks keep internal validation while the UI registers download completion", async () => {
  const [renderer, main] = await Promise.all([
    readFile(join(root, "src/renderer.js"), "utf8"),
    readFile(join(root, "main.mjs"), "utf8"),
  ]);

  assert.match(main, /validateBrandExportFile\(filePath, \[/);
  assert.match(main, /brandIntegrity,/);
  assert.match(main, /brandExportFileValidationCache/);
  assert.match(main, /if \(brandDownloadStarted\) return;/);
  assert.match(renderer, /updateBrandExportJob\(file\?\.jobId, "확인완료"/);
  assert.doesNotMatch(renderer, /100% 검증완료/);
  assert.doesNotMatch(renderer, /브랜드 불일치/);
});

test("file discovery excludes both legacy and current filtered workbook copies", async () => {
  const main = await readFile(join(root, "main.mjs"), "utf8");

  assert.match(main, /총판매량50이상_OR\|판매량30이상/);
  assert.match(main, /PROCESSED_BRAND_EXPORT_SUFFIX = "_총판매량50이상_OR_정리\.xlsx"/);
});
