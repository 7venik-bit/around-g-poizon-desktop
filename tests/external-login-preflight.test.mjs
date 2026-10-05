import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const main = readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function preflightBlock() {
  const start = main.indexOf("async function waitForDomesticLoginsBeforeSearch");
  const end = main.indexOf("async function domesticLoginStatuses", start);
  return main.slice(start, end);
}

test("SSG and Lotte log in through the external window before any product search", () => {
  const block = preflightBlock();
  assert.match(block, /EXTERNAL_LOGIN_RETAILER_IDS\.has\(sourceId\)/);
  assert.match(block, /openRetailerLoginForSearch\(sourceId/);
  assert.match(block, /외부 로그인 확인 완료/);
  // The external attempt never becomes a generic failure without its code.
  assert.match(block, /external\?\.automatic\?\.code/);
  // Chrome-less runtimes keep the existing in-app window path.
  assert.match(block, /fallbackInApp/);
  assert.match(block, /await openDomesticLogin\(sourceId, \{ background: sourceId === "naver" \}\)/);
});

test("anonymous SSG and Lotte cookies never satisfy the login check", () => {
  const start = main.indexOf("async function hasUsableDomesticLoginSession");
  const end = main.indexOf("function naverLoginScopeConfirmed", start);
  const block = main.slice(start, end);
  assert.match(block, /EXTERNAL_LOGIN_RETAILER_IDS\.has\(/);
  assert.match(block, /retailersNeedingLogin\.has\(sourceId\)/);
  assert.match(block, /confirmedExternalLogins\.get\(sourceId\)/);
  assert.match(block, /EXTERNAL_LOGIN_CONFIRM_TTL_MS/);
});

test("a mid-search login requirement forces the next preflight to re-verify", () => {
  assert.match(main, /noteExternalLoginRequired\(source\?\.store\)/);
  assert.match(main, /retailersNeedingLogin\.add\(sourceId\)/);
  assert.match(main, /confirmedExternalLogins\.delete\(sourceId\)/);
});

test("external login failures keep actionable Korean labels per code", async () => {
  const { runInNewContext: run } = await import("node:vm");
  const verdict = readFileSync(new URL("../src/domestic-result-verdict.js", import.meta.url), "utf8");
  const context = {};
  run(verdict, context);
  const { sourceVerdict } = context.AroundGDomesticVerdict;
  const labels = {
    chrome_not_found: "Chrome 설치 필요",
    chrome_launch_failed: "외부 로그인 실행 실패",
    cdp_unreachable: "외부 로그인 연결 실패",
    login_page_unreadable: "로그인 화면 인식 실패",
    login_blocked: "판매처 보안 차단 · 직접 확인",
    login_timeout: "외부 로그인 시간 초과",
    login_canceled: "로그인 중단",
  };
  for (const [reason, label] of Object.entries(labels)) {
    const result = sourceVerdict({ store: "SSG", verificationFailed: true, verificationReason: reason });
    assert.equal(result.label, label, reason);
    assert.equal(result.state, "failed", reason);
  }
});

test("LotteON external login starts at the login page with the saved method", () => {
  assert.match(main, /id: "lotte"[^}]*loginUrl: "https:\/\/www\.lotteon\.com\/p\/member\/login\/common/);
  assert.match(main, /method = accounts\.publicAccount\(sourceId\)\.method/);
  assert.match(main, /providerCredentials/);
  assert.match(main, /merchantDomains: source\.domains/);
});

test("store names map to their external login source", () => {
  const start = main.indexOf("function loginSourceIdForStore(");
  const end = main.indexOf("\n}\n", start) + 3;
  const context = {};
  runInNewContext(`${main.slice(start, end)}\nthis.mapped = {
    ssg: loginSourceIdForStore("SSG 백화점"),
    lotte: loginSourceIdForStore("롯데온 아울렛"),
    musinsa: loginSourceIdForStore("무신사"),
    naver: loginSourceIdForStore("네이버 패션타운"),
    kolon: loginSourceIdForStore("코오롱몰"),
    unknown: loginSourceIdForStore("병행수입·편집샵"),
  };`, context);
  assert.deepEqual({ ...context.mapped }, {
    ssg: "ssg",
    lotte: "lotte",
    musinsa: "musinsa",
    naver: "naver",
    kolon: "kolon",
    unknown: "",
  });
});
