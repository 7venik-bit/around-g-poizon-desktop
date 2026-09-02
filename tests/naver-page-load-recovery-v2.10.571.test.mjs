import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const patch = await readFile(new URL("../scripts/patch-naver-result-link-finalizer.mjs", import.meta.url), "utf8");
const fallbackPatch = await readFile(new URL("../scripts/patch-naver-direct-result-bootstrap.mjs", import.meta.url), "utf8");

test("네이버는 홈 세션을 만든 뒤 패션타운 결과 주소를 연다", () => {
  assert.match(patch, /const initialUrl = naverPortalSource \? "https:\/\/www\.naver\.com\/" : url/);
  assert.match(patch, /loadNaverFashionTownResultPage/);
  assert.match(patch, /if \(interactiveSiteSearch && !directNaverFashionResult\)/);
});

test("네이버 패션타운은 내부 SPA 로드 전에 정상 검색 링크를 즉시 반환한다", () => {
  assert.match(patch, /if \(directNaverFashionResult\) \{\\n    return createDomesticSearchLinkResult/);
  assert.match(patch, /store: source\.store, articleNumber, resolvedSearchUrl: url/);
});

test("첫 탐색 오류 뒤에도 실제 결과 DOM을 확인하고 같은 검색을 한 번만 복구한다", () => {
  assert.match(main, /async function loadNaverFashionTownResultPage/);
  assert.match(main, /const firstResult = await inspectSettledResult\(\)/);
  assert.match(main, /session\.clearCache\(\)/);
  assert.match(main, /const retryResult = await inspectSettledResult\(\)/);
  assert.match(main, /state\.cards > 0 \|\| state\.explicitEmpty \|\| state\.positiveCount/);
});

test("복구 실패는 페이지 로드 실패 대신 정확한 검색 링크로 표시한다", () => {
  assert.match(fallbackPatch, /resolvedSearchUrl: url,/);
  assert.match(fallbackPatch, /resultLinkOnly: true,/);
  assert.match(fallbackPatch, /verificationReason: "",/);
  assert.match(fallbackPatch, /const patchedFailure = `[\s\S]*return \{[\s\S]*resultLinkOnly: true,/);
  assert.match(fallbackPatch, /!documentReady && !recoveredMusinsaResult && !directNaverFashionResult/);
});

test("검색 링크 판정은 최종 소스 행까지 손실 없이 전달된다", () => {
  assert.match(main, /resultLinkOnly: result\?\.resultLinkOnly === true,/);
  assert.match(main, /verificationFailed: result\?\.resultLinkOnly === true \? false/);
  assert.match(main, /verificationPending: result\?\.resultLinkOnly === true \? false/);
});
