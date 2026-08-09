import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("selected-brand export keeps the automated Seller Center window minimized", () => {
  const automationStart = mainSource.indexOf("async function automateSellerBrandExport");
  const automationEnd = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", automationStart);
  const automationSource = mainSource.slice(automationStart, automationEnd);

  assert.match(
    automationSource,
    /openSellerCenterWindow\(SELLER_PRODUCT_SEARCH_URL, \{[\s\S]*?visible: false,[\s\S]*?activate: false,[\s\S]*?deferNavigation: true/,
  );
  assert.match(automationSource, /sellerWindow\.showInactive\(\)/);
  assert.match(automationSource, /sellerWindow\.minimize\(\)/);
  assert.match(automationSource, /backgroundThrottling is disabled/);
});

test("seller automation navigates once and emits evidence instead of optimistic progress", () => {
  assert.match(mainSource, /const deferNavigation = options\.deferNavigation === true/);
  assert.match(mainSource, /if \(!deferNavigation && targetUrl\) sellerWindow\.loadURL\(targetUrl\)/);
  assert.match(mainSource, /jobState: "1단계\/5 · 판매자센터 연결 시도"/);
  assert.match(mainSource, /jobState: connectedPage\.login \? "1단계\/5 · 판매자센터 로그인 필요" : "1단계\/5 · 판매자센터 페이지 연결 확인"/);
  assert.match(mainSource, /inputValue: String\(input\.value/);
  assert.match(mainSource, /resultRowCount: verifiedState\.rowTexts\.length/);
  assert.match(mainSource, /전체 내보내기·다운로드센터 이동 완료/);
  assert.match(mainSource, /confirmSellerExportRequest/);
  assert.match(mainSource, /clickSellerDownloadCenterShortcut/);
  assert.match(mainSource, /DOWNLOAD_CENTER_SHORTCUT_NOT_FOUND/);
  assert.match(mainSource, /EXPORT_CONFIRMATION_NOT_ACKNOWLEDGED/);
  assert.match(mainSource, /readSellerExportJobsFromMonitor\(\)/);
  assert.match(mainSource, /captureSellerDiagnostic/);
  assert.match(mainSource, /executeSellerFrameWithTimeout/);
  assert.match(mainSource, /Promise\.all\(frames\.map/);
  assert.match(mainSource, /응답하지 않는 POIZON 내부 프레임은 4초 후 건너뜁니다/);
  assert.match(mainSource, /pauseOfficialDomainAuditForSellerAutomation/);
  assert.match(mainSource, /공식몰 전체 검증을 멈추고 POIZON 브랜드 검색을 우선 실행합니다/);
  assert.match(mainSource, /검증 계속 버튼을 누를 때만 재개됩니다/);
});

test("seller search targets the proven global query beside Search and Bid", () => {
  assert.ok(mainSource.includes("/^검색\\\\s*및\\\\s*입찰$/"));
  assert.match(mainSource, /const exactSearchButton = exactSearchButtons/);
  assert.match(mainSource, /candidate\.verticalDistance < 24/);
  assert.match(mainSource, /candidate\.horizontalGap >= -4 && candidate\.horizontalGap < 80/);
  assert.match(mainSource, /const input = exactInput \|\| searchInputs\[0\]/);
  assert.match(mainSource, /const search = exactSearchButton \|\| searchCandidates/);
  assert.match(mainSource, /new InputEvent\("input"/);
  assert.match(mainSource, /input\._valueTracker/);
  assert.match(mainSource, /input\._valueTracker\.setValue\(previousValue\)/);
  assert.match(mainSource, /actualInputValue: String\(input\.value/);
  const automationStart = mainSource.indexOf("async function automateSellerBrandExport");
  const automationEnd = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", automationStart);
  const automationSource = mainSource.slice(automationStart, automationEnd);
  assert.doesNotMatch(automationSource, /typeSellerBrandWithRealKeyboard\(candidate\.frame/);
  assert.match(automationSource, /runSellerSearch\(candidate\.frame\)/);
  assert.match(automationSource, /기존 검색 서비스 방식으로 브랜드를 입력하고 검색을 실행합니다/);
});

test("manual Seller Center actions remain visible by default", () => {
  const openStart = mainSource.indexOf("function openSellerCenterWindow");
  const openEnd = mainSource.indexOf("async function waitForSellerExportAndDownload", openStart);
  const openSource = mainSource.slice(openStart, openEnd);

  assert.match(openSource, /const visible = options\.visible !== false/);
  assert.match(openSource, /const activate = options\.activate !== false/);
  assert.match(openSource, /show: visible && activate/);
  assert.match(mainSource, /ipcMain\.handle\("seller:open", \(\) => \{\s*openSellerCenterWindow\(\)/);
});
