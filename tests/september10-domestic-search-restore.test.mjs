import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = (await readFile(new URL("../main.mjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const renderer = (await readFile(new URL("../src/renderer.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("restoration uses one production collector, without the broken shadow IPC path", () => {
  const handler = main.slice(main.indexOf('ipcMain.handle("domestic:search"'), main.indexOf('ipcMain.handle("domestic:cancel"'));
  assert.doesNotMatch(main, /(?:runSeptember10DomesticSearch|async function september10)/);
  assert.equal((main.match(/async function renderedSearchSourceResult\(/g) || []).length, 1);
  assert.match(handler, /matched = await addRenderedSearchCounts\(/);
  assert.match(handler, /preserveVerifiedResults/);
});

test("the production detail collector waits for public stock and preserves every product", () => {
  const source = main.slice(main.indexOf("async function renderedSearchSourceResult"), main.indexOf("async function addRenderedSearchCounts"));
  assert.match(source, /const productOpened = await clickRenderedProductCard/);
  assert.match(source, /await waitForDomesticDetailReady\(/);
  assert.match(source, /const observed = await collectRenderedProductStock\(/);
  assert.match(source, /stockEvidence = observed/);
  assert.match(source, /products\.push\(\{[\s\S]*?\.\.\.stockEvidence,/);
  assert.doesNotMatch(source, /analyzed\.products\.slice\(0, 8\)/);
});

test("marketplaces use their own navigation adapters before product extraction", () => {
  const source = main.slice(main.indexOf("async function renderedSearchSourceResult"), main.indexOf("async function addRenderedSearchCounts"));
  assert.match(source, /const domesticRetailerSource = ssgChannelSource \|\| \/\^롯데온/);
  assert.match(source, /if \(!directNaverFashionResult && !musinsaSource && !domesticRetailerSource\) try/);
  assert.match(source, /if \(domesticRetailerSource\) \{[\s\S]*?loadDomesticRetailerResultPage/);
  assert.match(source, /if \(musinsaSource\) \{[\s\S]*?loadMusinsaResultPage/);
  assert.match(source, /if \(directNaverFashionResult\) \{[\s\S]*?loadNaverFashionTownResultPage/);
});

test("popular, brand and category product rows share the same cached search function", () => {
  assert.match(renderer, /async function cachedDomesticSearch\(product, verifyLinkCounts = true\)/);
  assert.match(renderer, /async function searchDomesticAt\([\s\S]*?cachedDomesticSearch\(product/);
  assert.match(renderer, /async function searchExcelPreviewProduct\([\s\S]*?cachedDomesticSearch\(product/);
  assert.match(renderer, /#category-search[\s\S]*?searchExcelPreviewProduct/);
});

test("the result remains a lower list directly after each POIZON product row", () => {
  assert.match(renderer, /<tr class="excel-product-search-detail[\s\S]*?\$\{renderDomestic\(result, product/);
  assert.doesNotMatch(renderer, /data-domestic-stock-refresh/);
});
