import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, preload, renderer, workspace] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/poizon-review-workspace.js", import.meta.url), "utf8"),
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
  assert.match(begin, /sellerWindow\.setOpacity\?\.\(0\)/);
  assert.match(begin, /sellerWindow\.showInactive\(\)/);
});

test("대조 알림창은 상단 데이터 대조 버튼에서만 시작한다", () => {
  const category = renderer.slice(renderer.indexOf('$("#category-search").addEventListener'), renderer.indexOf('async function showPoizonExcelVerificationPair'));
  assert.doesNotMatch(category, /openReviewPopup|beginLiveVerification|beginSellerExcelVerification|syncExcelWithSellerScreen/);
  assert.match(renderer, /add\("poizon-review-brand-start", "상품 대조", document\.querySelector\("\.header-actions"\)\)/);
  assert.match(renderer, /await openVerifiedCombinedBrandPreview\(files\)/);
});

test("장시간 검증 중 현재 POIZON 페이지와 Excel 파일명을 함께 안내한다", () => {
  assert.match(renderer, /왼쪽 POIZON \$\{page\}\/\$\{pages \|\| "\?"\}페이지 · 오른쪽 Excel \$\{fileName\}/);
  assert.match(renderer, /교차 검증 중 · POIZON/);
});

test("검증 종료 시 메인 창을 유지하고 POIZON 창은 백그라운드에 둔다", () => {
  assert.match(main, /function endSellerExcelVerificationWindows/);
  assert.match(main, /mainWindow\.setBounds\(saved\.mainBounds\)/);
  assert.match(main, /sellerWindow\.hide\(\)/);
  assert.match(workspace, /await api\.endSellerExcelVerification\?\.\(\)/);
});
