import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, relay] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"),
]);

test("검색 카드 결과는 재고로 확정하지 않고 상세페이지까지 확인한다", () => {
  assert.doesNotMatch(main, /if \(!source\.linkOnly && source\.ok && Number\(source\.count \|\| 0\) > 0\)/);
  assert.match(main, /renderedSearchSourceResult\(source, articleNumber, brand, title\)/);
  assert.match(main, /detailArticleVerificationRequired[\s\S]*exactArticleIdentityMatch\(detailText, articleNumber\)/);
});

test("품번이 생략된 무신사 카드는 상세 검증 대기 후보로 유지한다", () => {
  assert.match(relay, /String\(store \|\| ""\) === "무신사"[\s\S]*detailArticleVerificationRequired = true/);
  assert.doesNotMatch(relay, /products = products\.filter\(\(product\) => exactArticleIdentityMatch/);
});
