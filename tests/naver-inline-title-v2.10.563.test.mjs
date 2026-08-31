import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

test("Naver whole-card accessibility text is replaced by the POIZON product title", () => {
  assert.match(inline, /function displayedProductTitle\(product = \{\}, sourceProduct = \{\}\)/);
  assert.match(inline, /raw\.length > 72/);
  assert.match(inline, /배송\\s\*옵션/);
  assert.match(inline, /wholeCardText && sourceTitle \? sourceTitle : raw/);
});

test("displayed Naver titles are bounded while raw text remains in the tooltip", () => {
  assert.match(inline, /selected\.length > 46/);
  assert.match(inline, /title="\$\{safeText\(rawTitle\)\}"/);
  assert.match(inline, /displayedProductTitle\(product, sourceProduct\)/);
});
