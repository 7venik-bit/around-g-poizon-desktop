import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, preload] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
]);
const start = main.indexOf("async function captureSellerBrandSales");
const end = main.indexOf("async function lookupSellerTransactionPrice", start);
assert.ok(start >= 0 && end > start);
const capture = main.slice(start, end);

test("판매자센터 화면 수집 함수는 renderer와 main 사이에 연결된다", () => {
  assert.match(preload, /captureSellerBrandSales: \(input = \{\}\) => ipcRenderer\.invoke\("seller:capture-brand-sales", input\)/);
  assert.match(main, /ipcMain\.handle\("seller:capture-brand-sales"[^\n]+captureSellerBrandSales\(input\)/);
});

test("판매자센터 로그인 확인 후 화면 동기화를 시작한다", () => {
  assert.match(capture, /await ensureSellerLoginBeforeBrandSearch/);
  assert.match(capture, /code: login\.code \|\| "SELLER_LOGIN_REQUIRED"/);
  assert.match(capture, /code: "SELLER_PRODUCT_SEARCH_UNAVAILABLE"/);
});

test("화면 동기화는 기존 POIZON 브랜드 검색 동작을 먼저 사용한다", () => {
  assert.match(capture, /await typeSellerBrandWithRealKeyboard/);
  assert.match(capture, /route: "EXISTING_POIZON_BRAND_SEARCH"/);
  assert.match(capture, /preferredSellerBrandSearchName\(brandNames\)/);
});

test("판매자센터 화면을 표시한 상태에서 실제 입력과 페이지 이동을 수행한다", () => {
  const showIndex = capture.indexOf("sellerWindow.show();");
  const searchIndex = capture.indexOf("await typeSellerBrandWithRealKeyboard");
  const hideIndex = capture.lastIndexOf("sellerWindow.hide()");
  assert.ok(showIndex >= 0 && showIndex < searchIndex);
  assert.ok(hideIndex > searchIndex);
  assert.match(capture, /code: "SELLER_BRAND_SEARCH_FAILED"/);
});

test("판매자센터 동기화는 20개씩 하단 페이지를 실제로 순회한다", () => {
  assert.ok(capture.includes('/20\\\\s*건\\\\/페이지/'));
  assert.match(capture, /directPage \|\| next/);
  assert.match(capture, /expectedNextPage/);
  assert.match(capture, /nextState\?\.page === expectedNextPage/);
  assert.match(capture, /nextState\.rowSignature !== capture\.rowSignature/);
  assert.doesNotMatch(capture, /sort\(\(left, right\) => right\.size - left\.size\)/);
});

test("마지막 페이지와 전체 행 수 검증 전에는 부분 데이터를 저장하지 않는다", () => {
  assert.match(capture, /lastCapturedPage >= expectedPageCount/);
  assert.match(capture, /capturedRowCount >= sellerSourceTotal/);
  assert.match(capture, /code: "SELLER_PAGINATION_INCOMPLETE"/);
  assert.match(capture, /부분 데이터는 저장하지 않습니다/);
});
