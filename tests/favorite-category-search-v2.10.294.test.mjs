import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [renderer, main, html] = await Promise.all([
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
]);

test("카테고리 검색은 인기리스트 대신 다운로드 완료 브랜드를 전달한다", () => {
  assert.match(renderer, /const favoriteBrandIds = \[\.\.\.categoryBrandIds\]/);
  assert.match(renderer, /const excelSales = await downloadedBrandSalesByArticle\(brand\)/);
  assert.match(renderer, /captureSellerBrandSales\(\{/);
  assert.match(renderer, /mergeExcelProductsWithSellerScreen\(excelSales\.products, sellerResult\.products/);
  assert.match(renderer, /const categoryProducts = crossValidated\.products/);
  assert.doesNotMatch(renderer, /const popularResult = await capturePopularProducts\(\{ runDomestic: false, renderResults: false \}\)/);
});

test("다운로드 완료 브랜드 구성이 바뀌면 별도의 카테고리 캐시를 사용한다", () => {
  assert.match(renderer, /categorySearchCacheId\(category, detail, minimumChinaSales30, minimumLocalSales30, brandIds = pinnedBrandIds\)/);
  assert.match(renderer, /:\$\{detail \|\| "all"\}:/);
  assert.match(renderer, /favorites:\$\{brandKey\}/);
  assert.match(renderer, /category:seller-screen-v7:/);
  assert.match(renderer, /다운로드 완료 브랜드가 없습니다/);
});

test("카테고리 필터는 POIZON 화면 최근 30일 값을 우선해 AND로 적용한다", () => {
  assert.match(renderer, /hasSalesData: screenProduct\.hasSalesData === true/);
  assert.match(renderer, /hasLocalSalesData: screenProduct\.hasLocalSalesData === true/);
  assert.match(renderer, /downloadedBrandSalesByArticle\(brand\)/);
  assert.match(renderer, /Number\(product\.sales30d \|\| 0\) >= minimumChinaSales30/);
  assert.match(renderer, /Number\(product\.localSales30d \|\| 0\) >= minimumLocalSales30/);
  assert.match(renderer, /salesSource: "seller-center-screen"/);
  assert.match(renderer, /const minimumChinaSales30 = categorySalesMinimum/);
  assert.match(html, /id="category-min-china-sales-30"[^>]+value="100"/);
  assert.match(html, /id="category-min-local-sales-30"[^>]+value="30"/);
  assert.doesNotMatch(html, /id="category-min-sales"/);
});

test("상단 다운로드 파일 동기화는 판매자센터 화면과 Excel을 교차 검증한다", () => {
  assert.match(html, /id="import-button"[^>]*>다운로드 파일 동기화<\/button>/);
  assert.doesNotMatch(html, /id="brand-download-clear"/);
  const start = renderer.indexOf('$("#import-button").addEventListener');
  const end = renderer.indexOf('$("#export-button").addEventListener', start);
  const handler = renderer.slice(start, end);
  assert.match(handler, /await restoreDownloadedBrandFiles\(\)/);
  assert.match(handler, /downloadedBrandFiles\.length[\s\S]*reusedLoadedFiles: true/);
  assert.match(handler, /화면에 불러온 OneDrive Excel/);
  assert.match(handler, /activateSearchServiceMode\?\.\("files"\)/);
  assert.match(handler, /for \(const \[brandPosition, brand\] of brands\.entries\(\)\)/);
  assert.match(handler, /await downloadedBrandSalesByArticle\(brand\)/);
  assert.match(handler, /await window\.aroundG\.captureSellerBrandSales/);
  assert.match(handler, /mergeExcelProductsWithSellerScreen/);
  assert.match(handler, /syncExcelWithSellerScreen/);
  assert.match(handler, /원본 Excel 수정 \$\{updatedExcelRows\.toLocaleString/);
  assert.match(handler, /upsert\("poizonSyncs"/);
  assert.match(handler, /POIZON 화면·Excel 동기화/);
  assert.doesNotMatch(handler, /importExcel\(/);
  assert.match(main, /ipcMain\.handle\("excel:sync-seller-screen"/);
  assert.match(main, /before-poizon-screen-sync-\$\{stamp\}\.bak/);
});

test("다운로드 동기화는 수동 POIZON 작업 복구 진행률과 분리한다", () => {
  assert.match(html, /POIZON 데이터 플랫폼 화면 값<\/b>을 우선 적용/);
  assert.match(main, /async function listBrandExportFiles\(\{ emitRecoveryProgress = false \} = \{\}\)/);
  assert.match(main, /if \(!emitRecoveryProgress\) return;/);
  assert.match(main, /emitRecoveryProgress: options\?\.recoveryProgress === true/);
  const syncStart = renderer.indexOf('$("#import-button").addEventListener');
  const syncEnd = renderer.indexOf('$("#export-button").addEventListener', syncStart);
  assert.doesNotMatch(renderer.slice(syncStart, syncEnd), /recoveryProgress:\s*true/);
  assert.match(renderer, /recoverInterruptedBrandWorkOnDemand[\s\S]*restoreDownloadedBrandFiles\(\{ recoveryProgress: true \}\)/);
});

test("다운로드 동기화 진행 상황을 브랜드·페이지·상품 수로 표시한다", () => {
  assert.match(html, /class="download-sync-anchor"[\s\S]*id="import-button"[\s\S]*id="excel-sync-progress"[^>]*aria-live="polite"/);
  assert.match(renderer, /if \(downloadFileSyncActive\)/);
  assert.match(renderer, /전체 \$\{percent\}% · \$\{brandName\} \$\{page\}\/\$\{pages \|\| "\?"\}페이지 ·/);
  assert.match(renderer, /동기화 진행 중 · \$\{page\}\/\$\{pages \|\| "\?"\}페이지/);
  assert.match(renderer, /개 상품 확인/);
  assert.match(renderer, /동기화 실패 · \$\{failures\[0\]\}/);
  assert.match(renderer, /startsWith\("SELLER_"\)/);
  assert.doesNotMatch(renderer, /syncProgress\.querySelector\("i"\)\.style\.width = "100%";[\s\S]{0,120}동기화 완료[^\n]+failures\.length/);
});
