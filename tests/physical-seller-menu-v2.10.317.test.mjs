import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const [main, pkg, lock] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
]);

test("v2.10.353은 분리 검색 모듈 없이 배포된다", async () => {
  assert.equal(pkg.version, "2.10.353");
  assert.equal(lock.version, "2.10.353");
  assert.equal(lock.packages[""].version, "2.10.353");
  await assert.rejects(access(new URL("../services/domestic-search-modules/index.mjs", import.meta.url)));
  assert.doesNotMatch(main, /domestic-search:module-status|onDomesticModuleStatus/);
});

test("판매자센터 상품검색 주소를 직접 열지 않는다", () => {
  assert.doesNotMatch(main, /SELLER_PRODUCT_SEARCH_URL/);
  assert.doesNotMatch(main, /loadURL\([^\n]*\/main\/goods\/search/);
  const start = main.indexOf("async function automateSellerBrandExport");
  const end = main.indexOf("async function syncBrandCatalogFromKrPoizon", start);
  const workflow = main.slice(start, end);
  assert.match(workflow, /openSellerCenterWindow\(SELLER_CENTER_URL/);
  assert.match(workflow, /await sellerWindow\.loadURL\(SELLER_CENTER_URL\)/);
  assert.doesNotMatch(main, /SELLER_MAIN_URL/);
  assert.match(workflow, /enterSellerProductSearchViaMenu\(\)/);
  assert.doesNotMatch(workflow, /productSearchOpened = await enterSellerProductSearchViaMenu\(\{ forceHome: true \}\)/);
});

test("판매자 메인에서 상품과 상품 검색 메뉴를 실제 Windows 마우스로 클릭한다", () => {
  const start = main.indexOf("async function enterSellerProductSearchViaMenu");
  const end = main.indexOf("async function ensureSellerLoginBeforeBrandSearch", start);
  const navigation = main.slice(start, end);
  assert.match(navigation, /physicalClickSellerElement/);
  assert.match(navigation, /"PHYSICAL_PRODUCT_MENU"/);
  assert.match(navigation, /"PHYSICAL_PRODUCT_SEARCH_MENU"/);
  assert.match(navigation, /sellerProductSearchPageState/);
  assert.ok(navigation.includes("상품(?:\\\\s*및\\\\s*입찰\\\\s*분석)?"));
  assert.ok(navigation.includes("홈페이지로\\\\s*돌아가기"));
  assert.match(navigation, /if \(state\.failed\) \{\s+const recovered = await recoverSellerHome\(\)/);
  assert.match(navigation, /if \(!await recoverSellerHome\(\)\) return false/);
  assert.doesNotMatch(navigation, /target\?\.click|productMenu\?\.click/);
});

test("판매자센터는 폐기될 수 있는 전체 시장 데이터 주소가 아닌 홈에서 시작한다", () => {
  assert.match(main, /const SELLER_CENTER_URL = "https:\/\/seller\.poizon\.com\/"/);
  const constants = main.slice(main.indexOf("const SELLER_CENTER_URL"), main.indexOf("const SELLER_EXPORT_CENTER_URL"));
  assert.doesNotMatch(constants, /dataCenter\/merchantRankBoard/);
});
