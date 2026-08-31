import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("one technical domestic-search failure retries once without repeating a confirmed zero", () => {
  const source = renderer.slice(
    renderer.indexOf("async function cachedDomesticSearch"),
    renderer.indexOf("function domesticSearchInput"),
  );
  assert.match(source, /const first = await run\(\)/);
  assert.match(source, /if \(first\?\.ok \|\| first\?\.canceled\) return first/);
  assert.match(source, /setTimeout\(resolve, 700\)/);
  assert.match(source, /return run\(\)/);
});

test("technical failure shows its actual reason instead of product absence", () => {
  assert.match(renderer, /검색 실패: \$\{text\(result\.error\)\}/);
  assert.doesNotMatch(renderer, /if \(result\.error\) return `<span class="inventory-help">상품없음<\/span>`/);
});
