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
  assert.match(html, /최근 30일 판매량<\/b>과 <b>현지 30일 판매량<\/b>은 원본 Excel에서 직접 입력/);
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
  assert.match(workflow, /POIZON 원본 Excel 다운로드 완료/);
  assert.doesNotMatch(workflow, /importBrandExcelFromPath/);
  assert.doesNotMatch(workflow, /processedPath|processedName|filteredRows/);
});

test("file list opens the original workbook and excludes generated filtered copies", async () => {
  const [renderer, main] = await Promise.all([
    readFile(join(root, "src/renderer.js"), "utf8"),
    readFile(join(root, "main.mjs"), "utf8"),
  ]);

  assert.match(renderer, /openOriginalExcelFile\(file\.path\)/);
  assert.match(renderer, /Excel 열기/);
  assert.match(main, /visibleFiles = files\.filter\(\(file\) => !isProcessedBrandExportName\(file\.name\)\)/);
});

test("downloaded workbooks are brand-validated before normal registration", async () => {
  const [renderer, main] = await Promise.all([
    readFile(join(root, "src/renderer.js"), "utf8"),
    readFile(join(root, "main.mjs"), "utf8"),
  ]);

  assert.match(main, /validateBrandExportFile\(filePath, \[/);
  assert.match(main, /brandIntegrity,/);
  assert.match(main, /brandExportFileValidationCache/);
  assert.match(main, /if \(brandDownloadStarted\) return;/);
  assert.match(renderer, /file\?\.brandIntegrity\?\.ok === false/);
  assert.match(renderer, /불일치 파일은 삭제하지 않았으며 정상 자료로 처리하지 않았습니다/);
  assert.match(renderer, /Excel 확인/);
});
