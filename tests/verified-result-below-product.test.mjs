import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("verified brand results expand as a full-width list below the searched product", () => {
  const start = renderer.indexOf("function renderVerifiedSpuRows(");
  const end = renderer.indexOf("function mergeDomesticSearchProducts(", start);
  const verifiedRenderer = renderer.slice(start, end);

  assert.match(verifiedRenderer, /excel-verified-search-detail/);
  assert.match(verifiedRenderer, /<td colspan="10">/);
  assert.match(verifiedRenderer, /renderDomestic\(result, p, keys\[i\]\)/);
  assert.match(verifiedRenderer, /result && !result\.loading/);
  assert.doesNotMatch(verifiedRenderer, /renderRawExcelDomesticCell/);
});

test("verified brand product row keeps only search state and retry control at the right edge", () => {
  const start = renderer.indexOf("function renderVerifiedSpuRows(");
  const end = renderer.indexOf("function mergeDomesticSearchProducts(", start);
  const verifiedRenderer = renderer.slice(start, end);

  assert.match(verifiedRenderer, /검색 완료/);
  assert.match(verifiedRenderer, /다시 검색/);
  assert.match(verifiedRenderer, /수달 사원이 검색 중/);
});
