import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, preload, renderer] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);

test("POIZON 판매자센터는 백그라운드에 두고 독립 대조 알림창을 전면에 표시한다", () => {
  assert.match(main, /function beginSellerExcelVerificationWindows/);
  assert.match(main, /sellerWindow\.hide\(\)/);
  assert.match(main, /backgroundSeller: true/);
  assert.match(main, /foregroundReview: true/);
  assert.match(preload, /beginSellerExcelVerification: .*seller:excel-verification-start/);
  assert.match(preload, /endSellerExcelVerification: .*seller:excel-verification-end/);
  assert.match(renderer, /openReviewPopup\(\)/);
});

test("검증 중 POIZON 자동화 창을 표시하거나 활성화하지 않는다", () => {
  const begin = main.slice(main.indexOf('function beginSellerExcelVerificationWindows'), main.indexOf('function endSellerExcelVerificationWindows'));
  assert.match(begin, /visible: false/);
  assert.match(begin, /sellerWindow\.hide\(\)/);
  assert.doesNotMatch(begin, /sellerWindow\.show/);
});

test("대조 알림창을 먼저 준비한 뒤 백그라운드 POIZON 수집을 시작한다", () => {
  const start = renderer.indexOf('async function prepareLivePoizonVerification');
  const end = renderer.indexOf('async function finishLivePoizonVerification', start);
  const flow = renderer.slice(start, end);
  const popup = flow.indexOf('await live.openReviewPopup()');
  const begin = flow.indexOf('beginSellerExcelVerification');
  assert.ok(popup >= 0 && begin > popup, "POIZON 수집 전에 전면 대조 알림창을 준비해야 한다");
});

test("장시간 검증 중 현재 POIZON 페이지와 Excel 파일명을 함께 안내한다", () => {
  assert.match(renderer, /왼쪽 POIZON \$\{page\}\/\$\{pages \|\| "\?"\}페이지 · 오른쪽 Excel \$\{fileName\}/);
  assert.match(renderer, /교차 검증 중 · POIZON/);
});

test("검증 종료 시 메인 창을 유지하고 POIZON 창은 백그라운드에 둔다", () => {
  assert.match(main, /function endSellerExcelVerificationWindows/);
  assert.match(main, /mainWindow\.setBounds\(saved\.mainBounds\)/);
  assert.match(main, /sellerWindow\.hide\(\)/);
  assert.match(renderer, /await window\.aroundG\.endSellerExcelVerification\?\.\(\)\.catch\(\(\) => \{\}\)/);
});
