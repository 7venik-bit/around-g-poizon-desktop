import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, rendererSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);



test("download-center jobs warn after twenty minutes and never expire before download", () => {
  assert.match(mainSource, /SELLER_EXPORT_MONITOR_DELAY_WARNING_MS = 20 \* 60 \* 1000/);
  assert.doesNotMatch(mainSource, /SELLER_EXPORT_MONITOR_TIMEOUT_MS/);
  assert.match(mainSource, /while \(brandExportJobs\.size\)/);
  assert.match(mainSource, /POIZON 처리 지연 · 감시 계속/);
  assert.doesNotMatch(mainSource, /POIZON 성공 대기 \d+분 초과/);
  assert.doesNotMatch(mainSource, /POIZON 데이터(?: 파일| 가져오기).*30분 안에/);
  assert.match(mainSource, /async function waitForSellerExportAndDownload\(\)[\s\S]*?while \(true\)/);
  assert.match(mainSource, /async function waitForSellerExportAndAutoDownload\(\)[\s\S]*?while \(true\)/);
  assert.match(mainSource, /async function watchLatestSellerExportEveryTenSeconds\(\)[\s\S]*?while \(true\)/);
  assert.match(mainSource, /const expectedIds = \[\.\.\.brandExportJobs\.keys\(\)\]/);
});


test("downloaded Excel compares POIZON result count with data rows, not unique SPUs", () => {
  assert.match(mainSource, /summarizePoizonRows\(getPoizonWorksheetRows\(workbook\)\)/);
  assert.match(mainSource, /actualProductCount = workbookSummary\.dataRowCount/);
  assert.match(mainSource, /actualProductCount < expectedProductCount/);
  assert.match(mainSource, /부분다운로드_\$\{actualProductCount\}_of_\$\{expectedProductCount\}/);
  assert.match(mainSource, /고유 SPU \$\{workbookSummary\.uniqueSpuCount/);
  assert.match(mainSource, /중복 \$\{workbookSummary\.duplicateSpuCount/);
  assert.match(mainSource, /빈 SPU \$\{workbookSummary\.blankSpuCount/);
  assert.match(mainSource, /확인완료로 처리하지 않습니다/);
  assert.match(rendererSource, /error\?\.jobState \|\| "데이터 가져오기 실패"/);
});

test("Excel reader is connected for both preview and ordinary import", () => {
  assert.match(mainSource, /import \{ readFirstDataSheet \} from "\.\/services\/excel-reader\.mjs"/);
  assert.match(mainSource, /const rows = await readFirstDataSheet\(await readFile\(filePath\)\)/);
  assert.match(mainSource, /const sheet = await readFirstDataSheet\(await readFile\(filePath\)\)/);
});

test("failed job rows render with a dedicated error class", () => {
  assert.match(rendererSource, /\? " is-error"/);
  assert.match(rendererSource, /brand-export-job-row\$\{stateClass\}/);
});

test("partial workbooks are preserved but excluded from completed file discovery", () => {
  assert.match(mainSource, /function isPartialBrandExportName/);
  assert.match(mainSource, /!isPartialBrandExportName\(entry\.name\)/);
});
