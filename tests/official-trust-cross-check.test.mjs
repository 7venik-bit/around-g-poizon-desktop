import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, renderer, style] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
]);

test("an exact official-domain product code is shown as verified with a separate product score", () => {
  assert.match(main, /officialStoreVerified: true/);
  assert.match(main, /sourceTrustLabel: "공식몰 확인완료"/);
  assert.match(main, /productMatchConfidence: 95/);
  assert.match(renderer, /품번 정확히 일치/);
  assert.match(renderer, /상품 일치도/);
  assert.match(renderer, /imageVerificationLabel/);
  assert.match(style, /\.confidence\.official/);
});

test("official products without an exact code never pass on a merely similar image", () => {
  assert.match(main, /if \(product\.store === "브랜드 공식몰"\) return false/);
  assert.match(main, /titleScore >= 70 && Number\(imageScore \|\| 0\) >= 95/);
});

test("duplicate searches use brand-code and product-code identity while image stays supporting evidence", () => {
  assert.match(renderer, /function productCrossCheckIdentity/);
  assert.match(renderer, /product\.brandCode \|\| product\.brandId/);
  assert.match(renderer, /if \(article\) return `code:/);
  assert.match(renderer, /An image is supporting evidence only/);
  assert.match(renderer, /domesticIdentitySearchCache\.has\(cacheKey\)/);
});

test("duplicate store results collapse by exact detected code rather than a similar image", () => {
  assert.match(main, /const uniqueProducts = new Map\(\)/);
  assert.match(main, /product\.detectedArticleNumber/);
  assert.match(main, /`\$\{product\.store\}:code:\$\{exactCode\}`/);
});
