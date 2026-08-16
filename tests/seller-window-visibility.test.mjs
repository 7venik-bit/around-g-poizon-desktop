import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");




test("manual Seller Center actions remain visible by default", () => {
  const openStart = mainSource.indexOf("function openSellerCenterWindow");
  const openEnd = mainSource.indexOf("async function waitForSellerExportAndDownload", openStart);
  const openSource = mainSource.slice(openStart, openEnd);

  assert.match(openSource, /const visible = options\.visible !== false/);
  assert.match(openSource, /const activate = options\.activate !== false/);
  assert.match(openSource, /show: visible && activate/);
  assert.match(mainSource, /ipcMain\.handle\("seller:open", \(\) => \{\s*openSellerCenterWindow\(\)/);
});


test("brand search remains hidden and never moves the Windows cursor", () => {
  const workflowStart = mainSource.indexOf("async function automateSellerBrandExport");
  const workflowEnd = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", workflowStart);
  const workflow = mainSource.slice(workflowStart, workflowEnd);
  const clickStart = mainSource.indexOf("async function physicalClickSellerElement");
  const clickEnd = mainSource.indexOf("async function performPhysicalSellerSortAndExport", clickStart);
  const clickSource = mainSource.slice(clickStart, clickEnd);
  const inputStart = mainSource.indexOf("async function typeSellerBrandWithRealKeyboard");
  const inputEnd = mainSource.indexOf("async function automateSellerBrandExport", inputStart);
  const inputSource = mainSource.slice(inputStart, inputEnd);

  assert.match(workflow, /POIZON 창을 표시하지 않고 결과 확인·정렬·내보내기를 백그라운드에서 진행합니다/);
  assert.doesNotMatch(workflow, /sellerWindow\.(?:show|showInactive|minimize|focus)\(/);
  assert.match(workflow, /sellerWindow\.hide\(\)/);
  assert.match(clickSource, /backgroundClicked: true/);
  assert.doesNotMatch(clickSource, /moveWindowsCursorAndClick|showInactive|\.focus\(\)/);
  assert.match(inputSource, /step: "BACKGROUND_SEARCH_BUTTON_CLICKED"/);
  assert.match(inputSource, /physicalCursorMoved: false/);
  assert.doesNotMatch(inputSource, /moveWindowsCursorAndClick|showInactive/);
});
