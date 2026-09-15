import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = (await readFile(new URL("../main.mjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const patch = await readFile(new URL("../scripts/patch-naver-result-link-finalizer.mjs", import.meta.url), "utf8");

test("네이버는 홈 세션을 만든 뒤 패션타운 결과 주소를 연다", () => {
  assert.match(patch, /const initialUrl = naverPortalSource \? "https:\/\/www\.naver\.com\/" : url/);
  assert.match(patch, /loadNaverFashionTownResultPage/);
  assert.match(patch, /if \(interactiveSiteSearch && !directNaverFashionResult\)/);
});

test("네이버 패션타운은 검색 링크에서 실제 상품 카드를 수집한다", () => {
  assert.doesNotMatch(patch, /if \(directNaverFashionResult\) \{\\n    return createDomesticSearchLinkResult/);
  assert.match(patch, /const resultPage = await loadNaverFashionTownResultPage/);
});

test("네이버는 전체 load 이벤트를 기다리지 않고 정확한 결과 DOM에서 계속한다", () => {
  assert.match(main, /async function loadNaverFashionTownResultPage/);
  assert.match(main, /const navigation = searchWindow\.loadURL\(targetUrl\)/);
  assert.match(main, /const firstResult = await inspectSettledResult\(\)/);
  assert.match(main, /isNaverRenderedResultReady\(\{ url: state\.href, text: state\.text, cards: state\.cards \}, expectedQuery\)/);
  assert.match(main, /if \(!directNaverFashionResult && !musinsaSource && !domesticRetailerSource\) try \{/);
  const loader = main.slice(main.indexOf("async function loadNaverFashionTownResultPage"), main.indexOf("async function renderedSearchSourceResult"));
  assert.doesNotMatch(loader, /session\.clearCache\(\)/);
  assert.doesNotMatch(loader, /30_000/);
});

test("현재 네이버 로더는 보안 확인과 수집 실패를 검색 완료 링크로 숨기지 않는다", () => {
  const start = main.indexOf('      if (directNaverFashionResult) {\n        const resultPage');
  const block = main.slice(start, main.indexOf('      if (interactiveOfficialSearch)', start));
  assert.match(block, /return renderedSearchFailure\(resultPage\.verificationReason/);
  assert.match(block, /resolvedSearchUrl: resultPage\.resolvedUrl \|\| url/);
  assert.doesNotMatch(block, /resultLinkOnly: true|searchCompleted: true/);
});

test("검색 링크 판정은 최종 소스 행까지 손실 없이 전달된다", () => {
  assert.match(main, /resultLinkOnly: result\?\.resultLinkOnly === true,/);
  assert.match(main, /verificationFailed: result\?\.resultLinkOnly === true \? false/);
  assert.match(main, /verificationPending: result\?\.resultLinkOnly === true \? false/);
});
