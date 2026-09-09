import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const bootstrap = String(await readFile(new URL("../bootstrap.mjs", import.meta.url), "utf8"));

test("domestic products render as one continuous price comparison", () => {
  assert.match(sourcing, /sourcing-price-comparison/);
  assert.match(sourcing, /sourcing-price-row/);
  assert.match(sourcing, /판매가/);
  assert.match(sourcing, /POIZON 대비/);
  assert.match(sourcing, /sourceAction/);
});

test("domestic sourcing UI announces platform detail stock collection", () => {
  assert.match(sourcing, /상세페이지의 재고 문구와 옵션을 그대로 표시합니다/);
  assert.match(sourcing, /product\?\.stockText/);
  assert.match(sourcing, /선택 상품 국내 검색/);
  assert.match(sourcing, /표시 목록 국내 검색/);
});

test("sourcing view is injected after the base renderer loads", () => {
  assert.match(bootstrap, /readFile\(new URL\("\.\/src\/sourcing-view\.js"/);
  assert.match(bootstrap, /executeJavaScript\(sourcingViewSource, true\)/);
});
