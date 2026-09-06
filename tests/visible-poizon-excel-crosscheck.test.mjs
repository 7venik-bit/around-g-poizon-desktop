import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, preload, renderer] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);

test("POIZON 판매자센터와 Excel 미리보기를 좌우로 동시에 표시한다", () => {
  assert.match(main, /safeStorage, screen, session, shell/);
  assert.match(main, /function beginSellerExcelVerificationWindows/);
  assert.match(main, /screen\.getDisplayMatching\(mainWindow\.getBounds\(\)\)\.workArea/);
  assert.match(main, /Math\.floor\(usableWidth \* 0\.55\)/);
  assert.match(main, /sellerSide: "left"/);
  assert.match(main, /excelSide: "right"/);
  assert.match(preload, /beginSellerExcelVerification: .*seller:excel-verification-start/);
  assert.match(preload, /endSellerExcelVerification: .*seller:excel-verification-end/);
  assert.match(renderer, /검증 화면 열림 · 왼쪽 POIZON \/ 오른쪽 Excel/);
});

test("검증 중에는 POIZON 창을 숨기지 않고 Excel과 동시에 유지한다", () => {
  assert.match(main, /if \(!sellerExcelVerificationLayout && sellerWindow && !sellerWindow\.isDestroyed\(\)\) sellerWindow\.hide\(\)/);
});

test("Excel을 먼저 표시한 뒤 POIZON 화면을 읽고 원본 Excel을 갱신한다", () => {
  const start = renderer.indexOf('$("#import-button").addEventListener("click", async () => {');
  const end = renderer.indexOf('$("#export-button").addEventListener("click", async () => {', start);
  assert.ok(start >= 0 && end > start);
  const syncFlow = renderer.slice(start, end);
  const showPair = syncFlow.indexOf("await showPoizonExcelVerificationPair(file, brandName);");
  const capture = syncFlow.indexOf("captureSellerBrandSales");
  const workbookSync = syncFlow.indexOf("syncExcelWithSellerScreen");
  const refreshedExcel = syncFlow.indexOf("await showExcelPreview(file, 0", workbookSync);
  assert.ok(showPair >= 0 && capture > showPair, "POIZON 수집 전에 Excel/POIZON 두 화면을 먼저 열어야 한다");
  assert.ok(workbookSync > capture, "POIZON 화면을 읽은 뒤에 Excel을 수정해야 한다");
  assert.ok(refreshedExcel > workbookSync, "수정된 Excel을 다시 읽어 화면에 갱신해야 한다");
  assert.match(syncFlow, /POIZON 화면 값 우선 적용/);
});

test("장시간 검증 중 현재 POIZON 페이지와 Excel 파일명을 함께 안내한다", () => {
  assert.match(renderer, /왼쪽 POIZON \$\{page\}\/\$\{pages \|\| "\?"\}페이지 · 오른쪽 Excel \$\{fileName\}/);
  assert.match(renderer, /교차 검증 중 · POIZON/);
});

test("검증 종료 시 사용자의 기존 창 배치를 복원한다", () => {
  assert.match(main, /function endSellerExcelVerificationWindows/);
  assert.match(main, /mainWindow\.setBounds\(saved\.mainBounds\)/);
  assert.match(main, /sellerWindow\.setBounds\(saved\.sellerBounds\)/);
  assert.match(renderer, /await window\.aroundG\.endSellerExcelVerification\(\)\.catch\(\(\) => \{\}\)/);
});
