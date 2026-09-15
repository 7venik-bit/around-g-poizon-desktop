import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = (await readFile(new URL("../main.mjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const renderer = (await readFile(new URL("../src/renderer.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("domestic product search uses the September 10 direct sequential collector", () => {
  assert.match(main, /async function september10RenderedSearchSourceResult\(source, articleNumber, brand = "", title = "", securityRetry = 0, searchAttempt = null, sharedNaverSession = null, generation = domesticSearchGeneration\)/);
  assert.match(main, /async function september10AddRenderedSearchCounts\(data, articleNumber, brand = "", title = "", generation = domesticSearchGeneration\)/);
  assert.match(main, /return runSeptember10DomesticSearch\(_event, input\);/);
  assert.match(main, /const queryResult = await september10RenderedSearchSourceResult\([\s\S]*?sharedNaverSession, generation,\n\s*\);/);
});

test("one detail visit immediately captures visible seller sizes and stock wording", () => {
  const source = main.slice(main.indexOf("async function september10RenderedSearchSourceResult"), main.indexOf("async function september10AddRenderedSearchCounts"));
  assert.match(source, /const productOpened = await september10ClickRenderedProductCard/);
  assert.match(source, /await september10OpenRenderedSizeOptions\(searchWindow\);/);
  assert.match(source, /const stockSnapshot = await searchWindow\.webContents\.executeJavaScript/);
  assert.match(source, /stockEvidence = normalizeRenderedStockEvidence\(stockSnapshot/);
  assert.match(source, /products\.push\(\{[\s\S]*?\.\.\.stockEvidence,/);
});

test("marketplaces use their own navigation adapters before product extraction", () => {
  const source = main.slice(main.indexOf("async function september10RenderedSearchSourceResult"), main.indexOf("async function september10AddRenderedSearchCounts"));
  assert.match(source, /const domesticRetailerSource = ssgChannelSource \|\| \/\^롯데온/);
  assert.match(source, /if \(!directNaverFashionResult && !musinsaSource && !domesticRetailerSource\) try/);
  assert.match(source, /if \(domesticRetailerSource\) \{[\s\S]*?loadDomesticRetailerResultPage/);
  assert.match(source, /if \(musinsaSource\) \{[\s\S]*?loadMusinsaResultPage/);
  assert.match(source, /if \(directNaverFashionResult\) \{[\s\S]*?september10LoadNaverFashionTownResultPage/);
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
