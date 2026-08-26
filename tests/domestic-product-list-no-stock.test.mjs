import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const bootstrap = String(await readFile(new URL("../bootstrap.mjs", import.meta.url), "utf8"));

test("domestic products render as one continuous vertical list", () => {
  assert.match(sourcing, /domestic-source-list sourcing-product-list/);
  assert.match(sourcing, /sourcing-product-list-row/);
  assert.match(sourcing, /sourcing-product-thumb/);
  assert.match(sourcing, /sourcing-product-price/);
  assert.match(sourcing, /판매처 열기/);
});

test("domestic sourcing UI leaves inventory to manual retailer check", () => {
  assert.match(sourcing, /재고는 판매처에서 직접 확인하세요/);
  assert.doesNotMatch(sourcing, /재고 있음/);
  assert.doesNotMatch(sourcing, /품절/);
  assert.doesNotMatch(sourcing, /sourcing-stock/);
  assert.match(sourcing, /선택 상품 국내 검색/);
  assert.match(sourcing, /표시 목록 국내 검색/);
});

test("sourcing view is injected after the base renderer loads", () => {
  assert.match(bootstrap, /readFile\(new URL\("\.\/src\/sourcing-view\.js"/);
  assert.match(bootstrap, /executeJavaScript\(sourcingViewSource, true\)/);
});
