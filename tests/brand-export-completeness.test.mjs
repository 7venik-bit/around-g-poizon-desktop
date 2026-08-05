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

test("brand export clearly separates pre-job verification from actual Seller Center work", () => {
  const start = mainSource.indexOf("async function automateSellerBrandExport");
  const end = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", start);
  const workflow = mainSource.slice(start, end);

  assert.match(rendererSource, /1단계\/5 · 상품 페이지 확인 준비 중 \(다운로드센터 작업 생성 전\)/);
  assert.match(workflow, /1단계\/5 · 상품 페이지 확인 중/);
  assert.match(workflow, /2단계\/5 · 전체 내보내기 클릭 완료 · 새 작업번호 확인 중/);
  assert.match(workflow, /3단계\/5 · 작업번호 생성 완료 · 처리 대기/);
  assert.match(mainSource, /4단계\/5 · POIZON 파일 처리 중/);
  assert.match(mainSource, /4단계\/5 · Excel 다운로드 중/);
  assert.match(rendererSource, /5단계\/5 · Excel 검증·프로그램 등록 중/);
  assert.match(rendererSource, /updateBrandExportJob\(file\?\.jobId, "확인완료"/);
  assert.ok(
    workflow.indexOf("2단계/5 · 전체 내보내기 클릭 완료")
      < workflow.indexOf("findNewSellerExportJob"),
    "job-number checks must be labeled only after the export click",
  );
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
