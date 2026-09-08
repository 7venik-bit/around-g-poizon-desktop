import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("네이버 패션타운 검색 URL도 실제 상품 카드를 읽는다", () => {
  assert.doesNotMatch(main, /if \(directNaverFashionResult\) \{\s*return createDomesticSearchLinkResult/);
  assert.match(main, /const resultPage = await loadNaverFashionTownResultPage/);
  assert.match(main, /const finalized = finalizeNaverFashionTownResult\(parsedContent/);
});

test("롯데온과 SSG 검색 URL은 링크만 반환하지 않고 공통 카드 파서를 거친다", () => {
  assert.doesNotMatch(main, /const directRetailResultLink/);
  assert.match(main, /const productCards = \[\]/);
  assert.match(main, /productCards\.push\(\{/);
});

test("배포 보정 스크립트는 병행수입 링크 변수를 중복 삽입하지 않는다", async () => {
  const patch = await readFile(new URL("../scripts/patch-naver-result-link-finalizer.mjs", import.meta.url), "utf8");
  assert.match(patch, /if \(!source\.includes\("const directParallelResultLink"\)\)/);
});
