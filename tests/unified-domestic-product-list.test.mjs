import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const patch = await readFile(new URL("../scripts/patch-official-trust-and-search-result.mjs", import.meta.url), "utf8");

test("all domestic sites use the Musinsa-style product list verdict", () => {
  assert.match(patch, /All domestic sites use the same simple result-list contract as Musinsa/);
  assert.match(patch, /상품 \\?\$\{products\.length\}개/);
  assert.match(patch, /상품 \\?\$\{matchedProducts\.length\}개/);
  assert.match(patch, /matchedProducts\.length \? "" : "상품 없음"/);
});
