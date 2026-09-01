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

test("technical failure exposes its actual stage and internal code", () => {
  const failed = sourceVerdict({
    store: "SSG",
    count: 0,
    verificationFailed: true,
    verificationReason: "page_load_failed",
    verificationStage: "page_navigation",
  });
  assert.equal(failed.state, "failed");
  assert.equal(failed.label, "검색 페이지 연결 실패 · page_load_failed");
  assert.equal(failed.reason, "page_load_failed");
  assert.equal(failed.stage, "page_navigation");
});

test("result summary uses the same canonical verdict", () => {
  const available = resultPresentation({ products: [], sources: [{ count: 1, countVerified: true, verificationFailed: true }] });
  assert.equal(available.label, "결과 1개");
  assert.equal(available.className, "available");
  const missing = resultPresentation({ products: [], sources: [{ count: 0, countVerified: true, absenceConfirmed: true }] });
  assert.equal(missing.label, "상품 없음");
  assert.equal(missing.className, "missing");
});

test("result summary preserves the next-day access cooldown label", () => {
  const cooldown = resultPresentation({
    accessLimitedUntil: "2026-08-31T00:05:00.000Z",
    error: true,
  });
  assert.equal(cooldown.label, "내일 재시도");
  assert.equal(cooldown.className, "pending");
});

test("Naver link-only result is never rendered as confirmation failure", () => {
  const link = sourceVerdict({
    store: "네이버 패션타운",
    count: 0,
    resultLinkOnly: true,
    verificationFailed: false,
  });
  assert.equal(link.state, "link");
  assert.equal(link.label, "검색 결과 링크");

  const summary = resultPresentation({ products: [], sources: [{ resultLinkOnly: true, count: 0 }] });
  assert.equal(summary.label, "검색 결과 링크");
  assert.equal(summary.className, "available");
});

test("official mall hides parser failure behind the usable result link", () => {
  const result = sourceVerdict({
    store: "브랜드 공식몰",
    count: 0,
    searchCompleted: true,
    verificationFailed: true,
    verificationReason: "result_parse_failed",
  });
  assert.equal(result.state, "link");
  assert.equal(result.label, "검색 결과");
});

test("official mall is missing only after an explicit empty result", () => {
  const result = sourceVerdict({
    store: "브랜드 공식몰",
    count: 0,
    searchCompleted: true,
    absenceConfirmed: true,
  });
  assert.equal(result.state, "missing");
  assert.equal(result.label, "상품 없음");
});

test("link-only mode never hides a confirmed empty Naver or official-mall result", () => {
  for (const store of ["네이버 패션타운", "브랜드 공식몰"]) {
    const result = sourceVerdict({
      store,
      count: 0,
      resultLinkOnly: true,
      searchCompleted: true,
      absenceConfirmed: true,
    });
    assert.equal(result.state, "missing", store);
    assert.equal(result.label, "상품 없음", store);
  }
});
