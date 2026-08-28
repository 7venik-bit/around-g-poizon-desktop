import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const relay = String(await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"));

test("Naver uses one overview result without channel reloads or clicks", () => {
  assert.match(main, /NAVER_SINGLE_OVERVIEW_SEARCH_V1/);
  assert.doesNotMatch(main, /searchWindow\.loadURL\(sharedNaverSession\.resultsUrl\)/);
  assert.match(main, /const naverChannelClickRequired = false;/);
  assert.match(main, /naverWholeViewChannel/);
  assert.match(main, /expectedNaverChannel/);
  assert.match(relay, /store: "네이버 패션타운", linkOnly: true, fashionTown: "overview"/);
  assert.doesNotMatch(relay, /store: "네이버 공식 브랜드스토어", linkOnly: true/);
  assert.doesNotMatch(relay, /store: "네이버 백화점", linkOnly: true/);
  assert.doesNotMatch(relay, /store: "네이버 아울렛", linkOnly: true/);
  assert.match(main, /source\.store === "네이버 패션타운"/);
});

test("Naver overview cards allow strong brand-title recognition without a visible model code", () => {
  assert.match(relay, /NAVER_SINGLE_OVERVIEW_SEARCH_V1/);
  assert.match(relay, /overviewChannel/);
  assert.match(relay, /brandMatched && titleIdentityMatch\(rawCardText, expectedTitle\)/);
  assert.match(relay, /isPlatformShoppingProductUrl\(productUrl\)/);
  assert.doesNotMatch(relay, /\^네이버\\s\/\.test\(String\(store \|\| ""\)\) && cards\.length === 1\s*&& brandMatched && titleIdentityMatch/);
});
