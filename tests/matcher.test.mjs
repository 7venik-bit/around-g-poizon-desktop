import test from "node:test";
import assert from "node:assert/strict";
import { scoreProductCandidate } from "../services/matcher.mjs";

test("상품코드, 상품명, 이미지 유사도를 종합 점수로 계산한다", () => {
  const result = scoreProductCandidate(
    { articleNumber: "DD1391-100", brand: "Nike", title: "Air Force 1 White" },
    { id: "123", brand: "Nike", name: "Nike Air Force 1 DD1391-100 White", url: "https://example.test/123" },
    0.9,
  );
  assert.equal(result.signals.code, "일치");
  assert.equal(result.signals.image, "높음");
  assert.ok(result.confidence >= 80);
});

test("이미지를 확인할 수 없으면 점수를 임의로 부여하지 않는다", () => {
  const result = scoreProductCandidate(
    { articleNumber: "AQ1774-102", title: "Nike Ebernon" },
    { id: "77", name: "다른 상품" },
  );
  assert.equal(result.signals.image, "확인 불가");
  assert.ok(result.confidence < 30);
});

test("상품명이 비슷해도 실제 상품코드가 다르면 충돌로 판정한다", () => {
  const result = scoreProductCandidate(
    { articleNumber: "3ACP6601N", brand: "MLB", title: "에이스 언스트럭쳐 볼캡 LA Black" },
    { brand: "MLB", title: "시그니처 언스트럭쳐 볼캡 LA Blue 3ACPB245N" },
    0.95,
  );
  assert.equal(result.signals.codeConflict, true);
  assert.equal(result.signals.code, "불일치");
});
