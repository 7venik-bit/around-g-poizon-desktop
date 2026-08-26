import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("Naver Shopping preserves the physical click and recovers its new-tab href", () => {
  const start = main.indexOf("async function clickNaverShoppingHomeMenu");
  const end = main.indexOf("async function openNaverFashionTownSearchInput", start);
  const route = main.slice(start, end);
  assert.match(route, /sendInputEvent\(\{ type: "mouseMove"/);
  assert.match(route, /href: String\(element\.href/);
  assert.match(route, /const afterPhysicalClickUrl/);
  assert.match(route, /if \(!\/\^https:\\\/\\\/shopping\\\.naver\\\.com/);
  assert.doesNotMatch(route, /if \(\/\^https:\\\/\\\/(?:www\\\.)\?naver/);
  assert.match(route, /await searchWindow\.loadURL\(target\.href\)/);
  assert.match(route, /const afterFashionClickUrl/);
});
