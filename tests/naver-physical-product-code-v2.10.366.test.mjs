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

test("v2.10.374 release metadata is synchronized", () => {
  assert.equal(pkg.version, "2.10.374");
  assert.equal(lock.version, "2.10.374");
  assert.equal(lock.packages[""].version, "2.10.374");
});

test("Naver physically enters Fashion Town, focuses the input, and clicks its search icon", () => {
  assert.match(mainSource, /const fashionLabels = \["패션타운", "패션위크"\]/);
  assert.match(mainSource, /label\.includes\(fashionLabel\)/);
  assert.match(mainSource, /return Boolean\(routeOrTitleMatched \|\| selectedMenuMatched \|\| searchScopeMatched\)/);
  assert.doesNotMatch(mainSource, /fashionTownRoute && searchInput/);
  assert.match(mainSource, /async function openNaverFashionTownSearchInput/);
  assert.match(mainSource, /\(\?:패션타운\|패션위크\)/);
  assert.match(mainSource, /상품명\\\\s\*또는\\\\s\*브랜드/);
  assert.match(mainSource, /document\.activeElement/);
  assert.match(mainSource, /async function typeNaverQueryLikeUser/);
  assert.match(mainSource, /type: "keyDown", keyCode: character/);
  assert.match(mainSource, /type: "char", keyCode: character/);
  assert.match(mainSource, /type: "keyUp", keyCode: character/);
  assert.match(mainSource, /for \(const keyDelay of \[220, 360\]\)/);
  assert.match(mainSource, /waitForInputValue\(exactQuery\.slice\(0, index \+ 1\)\)/);
  assert.match(mainSource, /await wait\(2_000\)/);
  assert.doesNotMatch(mainSource, /insertText\(exactQuery\)/);
  assert.match(mainSource, /sendInputEvent\(\{ type: "mouseDown", x: submitTarget\.x/);
  assert.doesNotMatch(mainSource, /if \(submitTarget\)[\s\S]{0,900}keyCode: "Enter"/);
});

test("Naver executes the required click, type, and magnifier sequence", () => {
  assert.match(
    mainSource,
    /clickNaverFashionTownMenu\(searchWindow\)[\s\S]*submitNaverShoppingSearch\(searchWindow, searchQuery\)/,
  );
  assert.match(
    mainSource,
    /openNaverFashionTownSearchInput\(searchWindow\)[\s\S]*typeNaverQueryLikeUser\(searchWindow, inputTarget, exactQuery\)[\s\S]*mouseDown", x: submitTarget\.x/,
  );
  assert.match(mainSource, /for \(let attempt = 0; attempt < 20 && !submitTarget; attempt \+= 1\)/);
  assert.match(mainSource, /if \(!submitTarget\) await wait\(300\)/);
  assert.match(mainSource, /const rightAdjacent = sameRow && horizontalGap >= -35 && horizontalGap <= 160/);
  assert.match(mainSource, /const clearOrToggle = \/입력\(\?:내용\)\?삭제\|지우기\|닫기\|clear/);
  assert.match(mainSource, /element\.hasAttribute\("aria-expanded"\)/);
  assert.match(mainSource, /const rightmostPriority = Math\.max\(0, Math\.min\(220, rect\.right - inputRect\.right\)\) \* 12/);
  assert.match(mainSource, /eligible: !clearOrToggle && \(explicitSearch \|\| typeSubmit \|\| rightAdjacent \|\| insideRightEdge\)/);
  assert.match(mainSource, /containerRect\.right - 24/);
  assert.match(mainSource, /await wait\(800\)/);
  assert.match(mainSource, /await wait\(attempt === 0 \? 1_500 : 500\)/);
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

test("POIZON's trailing category marker is never typed into Naver", async () => {
  const result = await queryDomesticProducts({
    query: "데상트 SR123UPS11-服 남녀공용 카라 셔츠",
    articleNumber: "SR123UPS11-服",
    brand: "데상트",
    title: "데상트 남녀공용 카라 셔츠",
    fetchImpl: async () => ({ ok: true, text: async () => "" }),
  });
  const naverSources = result.sources.filter((source) => source.store.startsWith("네이버"));
  assert.deepEqual(naverSources.map((source) => source.searchQuery), [
    "SR123UPS11",
    "SR123UPS11",
    "SR123UPS11",
  ]);
  assert.deepEqual(result.queryCandidates[0], "SR123UPS11");
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
