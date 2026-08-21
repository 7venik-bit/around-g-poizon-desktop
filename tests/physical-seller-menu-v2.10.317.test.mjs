import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const [main, pkg, lock] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
]);

test("v2.10.328은 분리 검색 모듈 없이 배포된다", async () => {
  assert.equal(pkg.version, "2.10.328");
  assert.equal(lock.version, "2.10.328");
  assert.equal(lock.packages[""].version, "2.10.328");
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
  assert.match(workflow, /enterSellerProductSearchViaMenu\(\{ forceHome: true \}\)/);
});

test("판매자 메인에서 상품과 상품 검색 메뉴를 실제 Windows 마우스로 클릭한다", () => {
  const start = main.indexOf("async function enterSellerProductSearchViaMenu");
  const end = main.indexOf("async function ensureSellerLoginBeforeBrandSearch", start);
  const navigation = main.slice(start, end);
  assert.match(navigation, /physicalClickSellerElement/);
  assert.match(navigation, /"PHYSICAL_PRODUCT_MENU"/);
  assert.match(navigation, /"PHYSICAL_PRODUCT_SEARCH_MENU"/);
  assert.match(navigation, /sellerProductSearchPageState/);
  assert.doesNotMatch(navigation, /target\?\.click|productMenu\?\.click/);
});
