import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/domestic-result-verdict.js", import.meta.url), "utf8");
const context = vm.createContext({ Intl, Number, Object, Array });
vm.runInContext(source, context);
const { sourceVerdict, resultPresentation } = context.AroundGDomesticVerdict;

test("visible product evidence overrides a simultaneous parser failure", () => {
  const official = sourceVerdict({
    store: "브랜드 공식몰",
    count: 3,
    countVerified: true,
    presenceConfirmed: true,
    verificationFailed: true,
  });
  assert.equal(official.state, "available");
  assert.equal(official.label, "상품 있음 · 3개");

  const naver = sourceVerdict({
    store: "네이버 패션타운",
    count: 1,
    searchCompleted: true,
    naverTrustedChannelEvidence: true,
    verificationFailed: true,
  });
  assert.equal(naver.state, "available");
  assert.equal(naver.label, "상품 있음 · 1개");
});

test("completed exact zero is product absence, not confirmation failure", () => {
  const lotte = sourceVerdict({
    store: "롯데온",
    count: 0,
    countVerified: true,
    absenceConfirmed: true,
    searchCompleted: true,
    verificationFailed: true,
  });
  assert.equal(lotte.state, "missing");
  assert.equal(lotte.label, "상품 없음");

  const parallel = sourceVerdict({
    store: "병행수입·편집샵",
    count: 0,
    absenceConfirmed: true,
    parallelRetailerListEnforced: true,
  });
  assert.equal(parallel.state, "missing");
  assert.equal(parallel.label, "상품 없음");
});

test("confirmation failure remains reserved for a technical failure without product evidence", () => {
  const failed = sourceVerdict({
    store: "브랜드 공식몰",
    count: 0,
    verificationFailed: true,
    verificationReason: "page_load_failed",
  });
  assert.equal(failed.state, "failed");
  assert.equal(failed.label, "확인 실패");
});

test("result summary uses the same canonical verdict", () => {
  const available = resultPresentation({ products: [], sources: [{ count: 1, countVerified: true, verificationFailed: true }] });
  assert.equal(available.label, "결과 1개");
  assert.equal(available.className, "available");
  const missing = resultPresentation({ products: [], sources: [{ count: 0, countVerified: true, absenceConfirmed: true }] });
  assert.equal(missing.label, "상품 없음");
  assert.equal(missing.className, "missing");
});
