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


test("brand search hides POIZON during result transition and shows it only for physical clicks", () => {
  const workflowStart = mainSource.indexOf("async function automateSellerBrandExport");
  const workflowEnd = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", workflowStart);
  const workflow = mainSource.slice(workflowStart, workflowEnd);
  const keyboardInput = workflow.indexOf("typeSellerBrandWithRealKeyboard");
  const minimizeAfterInput = workflow.indexOf("sellerWindow.minimize();", keyboardInput);
  const searchWait = workflow.indexOf("runSellerSearch(candidate.frame", keyboardInput);
  const physicalSort = workflow.indexOf("performPhysicalSellerSortAndExport", searchWait);
  assert.ok(keyboardInput >= 0);
  assert.ok(minimizeAfterInput > keyboardInput && minimizeAfterInput < searchWait);
  assert.ok(physicalSort > searchWait);
  assert.match(workflow, /정렬 클릭 순간에만 잠깐 표시합니다/);
  assert.match(mainSource, /async function physicalClickSellerElement[\s\S]*sellerWindow\.showInactive\(\)/);
});
