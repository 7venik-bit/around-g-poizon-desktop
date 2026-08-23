import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { queryDomesticProducts } from "../relay/domestic-search.mjs";

const [mainSource, relaySource, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);
const pkg = JSON.parse(packageSource);
const lock = JSON.parse(lockSource);

test("v2.10.367 release metadata is synchronized", () => {
  assert.equal(pkg.version, "2.10.367");
  assert.equal(lock.version, "2.10.367");
  assert.equal(lock.packages[""].version, "2.10.367");
});

test("Naver physically enters Fashion Town, focuses the input, and clicks its search icon", () => {
  assert.match(mainSource, /label === "패션타운"/);
  assert.ok(mainSource.includes('(?:main\\\\/|search\\\\/)?fashion-group'));
  assert.match(mainSource, /document\.activeElement/);
  assert.match(mainSource, /insertText\(exactQuery\)/);
  assert.match(mainSource, /clipboard\.writeText\(exactQuery\)/);
  assert.match(mainSource, /compact\(element\.value\) === compact\(\$\{JSON\.stringify\(exactQuery\)\}\)/);
  assert.match(mainSource, /compact\(element\.textContent\) !== "패션타운"/);
  assert.match(mainSource, /sendInputEvent\(\{ type: "mouseDown", x: submitTarget\.x/);
  assert.doesNotMatch(mainSource, /if \(submitTarget\)[\s\S]{0,900}keyCode: "Enter"/);
});

test("all restored Naver channels receive only the exact product code", async () => {
  const result = await queryDomesticProducts({
    query: "MLB 3ASXCA12N-50WHS 청키 라이너",
    articleNumber: "3ASXCA12N-50WHS",
    brand: "MLB",
    title: "MLB 청키 라이너",
    fetchImpl: async () => ({ ok: true, text: async () => "" }),
  });
  const naverSources = result.sources.filter((source) => source.store.startsWith("네이버"));
  assert.deepEqual(naverSources.map((source) => source.store), [
    "네이버 공식 브랜드스토어",
    "네이버 백화점",
    "네이버 아울렛",
  ]);
  assert.deepEqual(naverSources.map((source) => source.searchQuery), [
    "3ASXCA12N-50WHS",
    "3ASXCA12N-50WHS",
    "3ASXCA12N-50WHS",
  ]);
  assert.ok(naverSources.every((source) => !source.searchQuery.includes("MLB")));
});

test("the complete domestic seller sequence is restored", () => {
  for (const store of [
    "네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛", "무신사",
    "SSG", "SSG 백화점", "SSG 아울렛", "롯데온", "롯데온 백화점",
    "롯데온 아울렛", "병행수입·편집샵", "코오롱몰",
  ]) {
    assert.ok(relaySource.includes(`store: "${store}"`), `missing restored source: ${store}`);
  }
});
