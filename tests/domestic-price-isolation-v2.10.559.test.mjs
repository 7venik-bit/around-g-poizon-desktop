import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("price lookup uses an isolated browser session and queue", () => {
  assert.match(main, /DOMESTIC_PRICE_PARTITION = "persist:around-g-domestic-price"/);
  assert.match(main, /const activeDomesticPriceWindows = new Set\(\)/);
  assert.match(main, /let domesticPriceLookupQueue = Promise\.resolve\(\)/);
  assert.match(main, /partition: DOMESTIC_PRICE_PARTITION/);
  assert.match(main, /domesticPriceLookupQueue = task\.then/);
});

test("price lookup has bounded cleanup and never uses global domestic cancellation", () => {
  const lookup = main.slice(main.indexOf("async function lookupNaverDomesticPrice"), main.indexOf("async function readNaverFashionTownChannelCounts"));
  assert.match(lookup, /PRICE_LOOKUP_TIMEOUT/);
  assert.match(lookup, /finally \{/);
  assert.match(lookup, /priceWindow\.destroy\(\)/);
  assert.doesNotMatch(lookup, /domesticSearchGeneration|activeDomesticSearchWindows|cancelDomesticSearches/);
});

test("renderer requests only the isolated price collector", () => {
  assert.match(preload, /lookupDomesticPrice: \(input\) => ipcRenderer\.invoke\("domestic-price:lookup", input\)/);
  assert.match(renderer, /window\.aroundG\.lookupDomesticPrice\(domesticSearchInput\(product, \["naver"\], true\)\)/);
  assert.match(renderer, /try \{[\s\S]*lookupDomesticPrice[\s\S]*\} catch \(error\)/);
  assert.match(renderer, /다른 기능은 계속 사용할 수 있습니다/);
});
