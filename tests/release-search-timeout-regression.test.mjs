import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const releasePatch = await readFile(new URL("../scripts/patch-naver-result-link-finalizer.mjs", import.meta.url), "utf8");

test("release source keeps exactly one guarded Naver result navigation", () => {
  assert.equal((main.match(/const resultPage = await loadNaverFashionTownResultPage\(/g) || []).length, 1);
  assert.match(releasePatch, /if \(!source\.includes\(naverResultNavigationMarker\)\) replaceOnce/);
});

test("Musinsa accepts its exact result DOM without waiting for the page load event", () => {
  const loader = main.slice(main.indexOf("async function loadMusinsaResultPage"), main.indexOf("async function renderedSearchSourceResult"));
  assert.match(loader, /const navigation = searchWindow\.loadURL\(targetUrl\)/);
  assert.match(loader, /if \(state\?\.ready\) return/);
  assert.match(main, /if \(!directNaverFashionResult && !musinsaSource\) try/);
  assert.match(main, /if \(musinsaSource\) \{[\s\S]*?loadMusinsaResultPage/);
});
