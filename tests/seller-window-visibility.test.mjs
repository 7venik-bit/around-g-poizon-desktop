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


test("brand search runs in a hidden Seller Center renderer", () => {
  const workflowStart = mainSource.indexOf("async function automateSellerBrandExport");
  const workflowEnd = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", workflowStart);
  const workflow = mainSource.slice(workflowStart, workflowEnd);
  const clickStart = mainSource.indexOf("async function physicalClickSellerElement");
  const clickEnd = mainSource.indexOf("async function performPhysicalSellerSortAndExport", clickStart);
  const clickSource = mainSource.slice(clickStart, clickEnd);
  const inputStart = mainSource.indexOf("async function typeSellerBrandWithRealKeyboard");
  const inputEnd = mainSource.indexOf("async function automateSellerBrandExport", inputStart);
  const inputSource = mainSource.slice(inputStart, inputEnd);

  assert.match(workflow, /visible: false/);
  assert.match(workflow, /activate: false/);
  assert.match(workflow, /sellerWindow\.hide\(\)/);
  assert.doesNotMatch(clickSource, /moveWindowsCursorAndClick/);
  assert.match(clickSource, /backgroundInput: true/);
  assert.match(inputSource, /step: "BACKGROUND_SEARCH_BUTTON_CLICKED"/);
  assert.match(inputSource, /background: true/);
  assert.doesNotMatch(inputSource, /moveWindowsCursorAndClick/);
});
