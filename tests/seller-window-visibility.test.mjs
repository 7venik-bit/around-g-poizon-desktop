import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("selected-brand export keeps Seller Center hidden", () => {
  const automationStart = mainSource.indexOf("async function automateSellerBrandExport");
  const automationEnd = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", automationStart);
  const automationSource = mainSource.slice(automationStart, automationEnd);

  assert.match(
    automationSource,
    /openSellerCenterWindow\(SELLER_PRODUCT_SEARCH_URL, \{ visible: false, deferNavigation: true \}\)/,
  );
  assert.doesNotMatch(automationSource, /sellerWindow\.show\(\)/);
  assert.doesNotMatch(automationSource, /sellerWindow\.focus\(\)/);
});

test("seller automation navigates once and emits evidence instead of optimistic progress", () => {
  assert.match(mainSource, /const deferNavigation = options\.deferNavigation === true/);
  assert.match(mainSource, /if \(!deferNavigation && targetUrl\) sellerWindow\.loadURL\(targetUrl\)/);
  assert.match(mainSource, /jobState: "1단계\/5 · 판매자센터 연결 시도"/);
  assert.match(mainSource, /jobState: connectedPage\.login \? "1단계\/5 · 판매자센터 로그인 필요" : "1단계\/5 · 판매자센터 페이지 연결 확인"/);
  assert.match(mainSource, /inputValue: String\(input\.value/);
  assert.match(mainSource, /resultRowCount: verifiedState\.rowTexts\.length/);
  assert.match(mainSource, /전체 내보내기 클릭 확인/);
  assert.match(mainSource, /captureSellerDiagnostic/);
});

test("manual Seller Center actions remain visible by default", () => {
  const openStart = mainSource.indexOf("function openSellerCenterWindow");
  const openEnd = mainSource.indexOf("async function waitForSellerExportAndDownload", openStart);
  const openSource = mainSource.slice(openStart, openEnd);

  assert.match(openSource, /const visible = options\.visible !== false/);
  assert.match(openSource, /show: visible/);
  assert.match(mainSource, /ipcMain\.handle\("seller:open", \(\) => \{\s*openSellerCenterWindow\(\)/);
});
