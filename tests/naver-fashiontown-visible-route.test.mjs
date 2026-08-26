import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const simplify = await readFile(new URL("../scripts/patch-simplify-official-naver-search.mjs", import.meta.url), "utf8");
const verdict = await readFile(new URL("../scripts/patch-official-trust-and-search-result.mjs", import.meta.url), "utf8");

test("Naver Fashion Town uses the visible menu-click search route", () => {
  assert.doesNotMatch(simplify, /directNaverFashionTownSource/);
  assert.match(simplify, /visible Shopping\/Fashion Town click route/);
});

test("a visible matching product is never converted to absence", () => {
  assert.match(verdict, /const confirmed = allProducts\.length > 0 \|\| trustedChannelEvidence/);
  assert.match(verdict, /absenceConfirmed: explicitEmpty && !confirmed/);
  assert.match(verdict, /explicitEmpty \? "absent" : "pending"/);
  assert.match(verdict, /label: "결과 확인 중"/);
});
