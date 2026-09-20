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

test("technical failure keeps its stage and code in diagnostics without exposing the code in the row", () => {
  const failed = sourceVerdict({
    store: "SSG",
    count: 0,
    verificationFailed: true,
    verificationReason: "page_load_failed",
    verificationStage: "page_navigation",
  });
  assert.equal(failed.state, "failed");
  assert.equal(failed.label, "검색 페이지 연결 실패");
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

test("collector code errors are not labeled as retailer connection failures or absence", () => {
  const result = sourceVerdict({store:'네이버 패션타운', count:0, verificationFailed:true,
    verificationReason:'result_script_failed', verificationStage:'result_capture'});
  assert.equal(result.state, 'failed');
  assert.equal(result.label, '상품 수집 코드 실행 오류');
  assert.equal(result.stage, 'result_capture');
});

test("Naver collection timeout gives an actionable Korean retry status", () => {
  const result = sourceVerdict({store:"네이버 패션타운", verificationFailed:true,
    verificationReason:"collection_stalled", verificationStage:"product_detail"});
  assert.equal(result.label, "상품·재고 확인 지연 · 다시 가져오기 필요");
  assert.equal(result.reason, "collection_stalled");
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

test("missing saved Naver credentials are a login action, not a search failure", () => {
  const verdict = sourceVerdict({
    store: "네이버 패션타운",
    loginRequired: true,
    errorCode: "NAVER_CREDENTIALS_REQUIRED",
    verificationReason: "naver_credentials_required",
  });
  assert.equal(verdict.state, "login");
  assert.equal(verdict.label, "네이버 계정 저장 필요");
  assert.equal(verdict.className, "pending");
});

test("Naver automatic-login technical codes keep distinct user-facing states", () => {
  for (const [errorCode, label] of [
    ["NAVER_LOGIN_INPUTS_NOT_FOUND", "로그인 화면 인식 오류"],
    ["NAVER_LOGIN_WINDOW_CLOSED", "로그인 중단"],
    ["NAVER_LOGIN_URL_INVALID", "로그인 연결 오류"],
    ["NAVER_LOGIN_PAGE_NOT_CONFIRMED", "로그인 연결 오류"],
    ["NAVER_VERIFICATION_REQUIRED", "보안 확인 필요"],
  ]) {
    const verdict = sourceVerdict({ store: "네이버 패션타운", loginRequired: true, errorCode });
    assert.equal(verdict.label, label, errorCode);
    assert.notEqual(verdict.state, "failed", errorCode);
  }
});
