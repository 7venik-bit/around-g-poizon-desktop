import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

function loadPredicate() {
  const start = renderer.indexOf("function isBlockedDomesticResult(result) {");
  assert.notEqual(start, -1);
  const end = renderer.indexOf("function renderRawExcelDomesticCell", start);
  assert.notEqual(end, -1);
  const sandbox = {};
  runInNewContext(`${renderer.slice(start, end)}\nthis.isBlockedDomesticResult = isBlockedDomesticResult;`, sandbox);
  return sandbox.isBlockedDomesticResult;
}

test("login/security-gated empty results are blocked, not successful", () => {
  const blocked = loadPredicate();
  assert.equal(blocked({ products: [], sources: [{ loginRequired: true }] }), true);
  assert.equal(blocked({ products: [], sources: [{ securityVerificationRequired: true }] }), true);
  assert.equal(blocked({ products: [], sources: [{ verificationFailed: true }] }), true);
  assert.equal(blocked({ products: [], sources: [{ verificationPending: true }] }), true);
  assert.equal(blocked({ products: [], sources: [] }), false);
  assert.equal(blocked({ products: [], sources: [{ absenceConfirmed: true }] }), false);
  assert.equal(blocked({ products: [{ price: 1 }], sources: [{ loginRequired: true }] }), false);
  assert.equal(blocked({ products: [], error: "boom", sources: [{ loginRequired: true }] }), false);
  assert.equal(blocked({ products: [], partial: true, sources: [{ loginRequired: true }] }), false);
  assert.equal(blocked(null), false);
});

test("batch completion names blocked results instead of reporting success", () => {
  assert.match(renderer, /let blocked = 0;/);
  assert.match(renderer, /if \(response\?\.ok && isBlockedDomesticResult\(result\)\) blocked \+= groupKeys\.length;/);
  const tail = renderer.slice(renderer.indexOf("const skipSuffix = skippedCount > 0"));
  const partialAt = tail.indexOf("개 일부 결과");
  const failedAt = tail.indexOf("개 검색 실패");
  const blockedAt = tail.indexOf("개 로그인·확인 필요");
  const doneAt = tail.indexOf("검색을 완료했습니다");
  assert.ok(partialAt >= 0 && failedAt > partialAt && blockedAt > failedAt && doneAt > blockedAt);
  assert.match(tail, /해당 상품은 로그인 확인 후 다시 검색해 주세요/);
  // Existing success/failure wordings stay byte-identical.
  assert.match(renderer, /선택 상품 \$\{searchKeys\.length\.toLocaleString\("ko-KR"\)\}개 검색을 완료했습니다\./);
  assert.match(renderer, /개 검색 실패\. 각 상품의 안내를 확인해 주세요\./);
});
