import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const patch = await readFile(new URL("../scripts/patch-official-trust-and-search-result.mjs", import.meta.url), "utf8");

test("Naver Fashion Town result cards reach the same product renderer as Musinsa", () => {
  assert.match(patch, /let renderedProductCards = \[\]/);
  assert.match(patch, /productUrl, imageUrl, title, price/);
  assert.match(patch, /const exactQueryPage = compactCode/);
  assert.match(patch, /const totalMatch = bodyText\.match/);
  assert.match(patch, /exactQueryPage && productLink/);
  assert.match(patch, /naverVisibleResultCount > 0/);
  assert.match(patch, /count: Math\.max\(naverVisibleResultCount, allProducts\.length\)/);
  assert.ok(patch.includes('sourceStore: "네이버 패션타운"'));
  assert.match(patch, /imageVerifiedFromCard: Boolean\(card\.imageUrl\)/);
  assert.match(patch, /analyzedProducts\.length \? analyzedProducts : cardProducts/);
  assert.match(patch, /inStock: null/);
  assert.match(patch, /sizes: \[\]/);
  assert.match(patch, /\.slice\(0, 8\)/);
});
