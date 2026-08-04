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
    /openSellerCenterWindow\(SELLER_PRODUCT_SEARCH_URL, \{ visible: false \}\)/,
  );
  assert.doesNotMatch(automationSource, /sellerWindow\.show\(\)/);
  assert.doesNotMatch(automationSource, /sellerWindow\.focus\(\)/);
});

test("manual Seller Center actions remain visible by default", () => {
  const openStart = mainSource.indexOf("function openSellerCenterWindow");
  const openEnd = mainSource.indexOf("async function waitForSellerExportAndDownload", openStart);
  const openSource = mainSource.slice(openStart, openEnd);

  assert.match(openSource, /const visible = options\.visible !== false/);
  assert.match(openSource, /show: visible/);
  assert.match(mainSource, /ipcMain\.handle\("seller:open", \(\) => \{\s*openSellerCenterWindow\(\)/);
});
