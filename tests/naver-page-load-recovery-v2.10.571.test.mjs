import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const patch = await readFile(new URL("../scripts/patch-naver-result-link-finalizer.mjs", import.meta.url), "utf8");

test("네이버는 홈 세션을 만든 뒤 패션타운 결과 주소를 연다", () => {
  assert.match(patch, /const initialUrl = naverPortalSource \? "https:\/\/www\.naver\.com\/" : url/);
  assert.match(patch, /loadNaverFashionTownResultPage/);
  assert.match(patch, /if \(interactiveSiteSearch && !directNaverFashionResult\)/);
});

test("첫 탐색 오류 뒤에도 실제 결과 DOM을 확인하고 같은 검색을 한 번만 복구한다", () => {
  assert.match(main, /async function loadNaverFashionTownResultPage/);
  assert.match(main, /const firstResult = await inspectSettledResult\(\)/);
  assert.match(main, /session\.clearCache\(\)/);
  assert.match(main, /const retryResult = await inspectSettledResult\(\)/);
  assert.match(main, /state\.cards > 0 \|\| state\.explicitEmpty \|\| state\.positiveCount/);
});

test("복구 실패는 연결·시간초과·일반 로드 오류를 구분한다", () => {
  assert.match(patch, /resultPage\.timeout \? "page_load_timeout"/);
  assert.match(patch, /resultPage\.networkError \? "network_error" : "page_load_failed"/);
  assert.match(patch, /errorMessage: resultPage\.errorMessage/);
});
