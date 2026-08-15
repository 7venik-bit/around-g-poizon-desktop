import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("official results replace search-card images with the product detail image", () => {
  assert.match(main, /async function officialDetailImage/);
  assert.match(main, /application\/ld\+json/);
  assert.match(main, /meta\[property=\"og:image\"\]/);
  assert.match(main, /imageUrl: detailImageUrl/);
  assert.match(main, /imageVerifiedFromDetail: Boolean\(detailImageUrl\)/);
});

test("failed official detail lookups never reuse a neighbouring search-card image", () => {
  assert.match(main, /Never replace a failed detail-page lookup with an image borrowed/);
  assert.doesNotMatch(main, /imageUrl: detailImageUrl \|\| product\.imageUrl/);
});
