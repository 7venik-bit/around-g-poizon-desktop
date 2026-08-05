import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, rendererSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);

test("brand export visits every Seller Center page before clicking export", () => {
  const start = mainSource.indexOf("async function verifyCompleteSellerExportAndClick");
  const end = mainSource.indexOf("async function automateSellerBrandExport", start);
  const workflow = mainSource.slice(start, end);

  assert.match(workflow, /const uniqueProducts = new Set\(\)/);
  assert.match(workflow, /page <= 1_000/);
  assert.match(workflow, /actual < expected/);
  assert.match(workflow, /code: "PARTIAL_PRODUCT_COLLECTION"/);
  assert.ok(
    workflow.indexOf("actual < expected") < workflow.lastIndexOf("exportButton.click()"),
    "the completeness guard must run before the export click",
  );
});

test("a partial collection is retried once without consuming a download", () => {
  const start = mainSource.indexOf("async function automateSellerBrandExport");
  const end = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", start);
  const workflow = mainSource.slice(start, end);

  assert.match(workflow, /attempt <= 2/);
  assert.match(workflow, /verifyCompleteSellerExportAndClick\(searched\.expectedTotal\)/);
  assert.match(workflow, /전체 상품이 확인되지 않아 다운로드를 차단했습니다/);
});

test("downloaded Excel is not marked complete when unique SPU count is short", () => {
  assert.match(mainSource, /readPoizonColumnValues\(fileBuffer, "SPU ID", "SPU_ID", "SPUID"\)/);
  assert.match(mainSource, /actualProductCount < expectedProductCount/);
  assert.match(mainSource, /부분다운로드_\$\{actualProductCount\}_of_\$\{expectedProductCount\}/);
  assert.match(mainSource, /확인완료로 처리하지 않습니다/);
  assert.match(rendererSource, /error\?\.jobState \|\| "데이터 가져오기 실패"/);
});

test("partial workbooks are preserved but excluded from completed file discovery", () => {
  assert.match(mainSource, /function isPartialBrandExportName/);
  assert.match(mainSource, /!isPartialBrandExportName\(entry\.name\)/);
});
