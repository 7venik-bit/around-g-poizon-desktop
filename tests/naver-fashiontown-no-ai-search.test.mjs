import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const start = main.indexOf("async function clickNaverFashionTownMenu");
const end = main.indexOf("async function typeNaverQueryLikeUser", start);
const route = main.slice(start, end);

// This also guards release builds from silently falling back to Naver AI search.\ntest("Naver search accepts only the Fashion Town menu and its product field", () => {
  assert.match(route, /const fashionLabels = \["패션타운"\]/);
  assert.doesNotMatch(route, /const fashionLabels = \["패션타운", "패션위크"\]/);
  assert.ok(route.includes("const fashionInput = /상품명\\\\s*또는\\\\s*브랜드/"));
  assert.match(route, /fashionInput[\s\S]*?\? 500/);
  assert.match(route, /: -1;/);
  assert.doesNotMatch(route, /const explicitSearch = \/검색\|search/);
});
