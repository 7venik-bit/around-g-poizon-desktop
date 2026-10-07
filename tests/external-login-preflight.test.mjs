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
  assert.match(main, /typeof noteExternalLoginRequired === "function"/);
  assert.match(main, /noteExternalLoginRequired\(source\?\.store\)/);
  assert.match(main, /source\?\.loginRequired === true \|\| source\?\.securityVerificationRequired === true/);
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

test("SSG external login starts at the member login popup with the saved method", () => {
  assert.match(main, /id: "ssg"[^}]*loginUrl: "https:\/\/member\.ssg\.com\/member\/popup\/popupLogin\.ssg/);
});

test("retailers share one external window that closes on quit", () => {
  assert.match(main, /let sharedExternalLoginChrome = null/);
  assert.match(main, /"external-login", "shared"/);
  assert.match(main, /keepAlive: true/);
  assert.match(main, /onShared: \(handle\) => \{\s*sharedExternalLoginChrome = \{ \.\.\.\(sharedExternalLoginChrome \|\| \{\}\), \.\.\.handle \};\s*\}/);
  assert.match(main, /closeLoginChrome\(sharedExternalLoginChrome\?\.child\)/);
});

test("external login heartbeats keep the search watchdog alive", () => {
  assert.match(main, /progressKey: `external-login:\$\{sourceId\}:\$\{tick\}`/);
  assert.doesNotMatch(main, /외부 로그인 확인`,/);
});

test("product searches mirror into the same shared tab without blocking", () => {
  assert.match(main, /async function showRetailerSearchInWindow\(sourceId, searchUrl, facetLabels = \[\], articleNumber = ""\)/);
  assert.match(main, /if \(queryAttemptIndex === 0 && queryAttempt\?\.url/);
  assert.match(main, /typeof loginSourceIdForStore === "function" && typeof showRetailerSearchInWindow === "function"/);
  assert.match(main, /queueRetailerMirror\(externalSourceId, \(\) => showRetailerSearchInWindow\(/);
  assert.match(main, /retailerFacetLabels\(externalSourceId, brand\), articleNumber,/);
  assert.match(main, /import \{[\s\S]*?acquireLoginTab,[\s\S]*?closeBlankTabs,[\s\S]*?clickSearchFacetsVisibly,[\s\S]*?\} from "\.\/services\/external-chrome-login\.mjs";/);
});

test("mirrored searches serialize per retailer so one tab shows one product at a time", () => {
  assert.match(main, /const retailerMirrorChains = new Map\(\)/);
  assert.match(main, /function queueRetailerMirror\(sourceId, run\)/);
  assert.match(main, /retailerMirrorChains\.get\(key\) \|\| Promise\.resolve\(null\)/);
  assert.match(main, /retailerMirrorChains\.set\(key, next\)/);
  // Collection never waits for the observational mirror.
  assert.doesNotMatch(main, /await queueRetailerMirror\(/);
});

test("the article click stays in the same tab instead of spraying product tabs", () => {
  const start = main.indexOf("async function showRetailerSearchInWindow(");
  const end = main.indexOf("let shoppingAccountServicesCache;", start);
  const mirror = main.slice(start, end);
  // Spawned product tabs are closed; the card opens in the same search tab.
  // Other retailers' tabs are preserved: the sweep only closes tabs that
  // appeared after the click snapshot.
  assert.match(mirror, /listPageTargets\(\{ fetchImpl: fetch, port:/);
  assert.match(mirror, /if \(knownTabIds\)/);
  assert.match(mirror, /closePageTarget\(\{ fetchImpl: fetch, port:[^}]*targetId: entry\.id \}\)/);
  assert.match(mirror, /await mirrorPage\(\)\.navigate\(cardUrl\)/);
  assert.ok(mirror.indexOf("closePageTarget") > mirror.indexOf("EXTERNAL_PRODUCT_CARD_POINT_SCRIPT"),
    "the sweep must run after the visible product click");
});

test("mirrored search drives a visible mouse from scope to product click", () => {
  const start = main.indexOf("async function showRetailerSearchInWindow(");
  const end = main.indexOf("let shoppingAccountServicesCache;", start);
  const mirror = main.slice(start, end);
  assert.match(mirror, /EXTERNAL_PRODUCT_CARD_POINT_SCRIPT/);
  assert.match(mirror, /\.clickPoint\(/);
  assert.ok(mirror.indexOf("closeBlankTabs") < mirror.indexOf("EXTERNAL_PRODUCT_CARD_POINT_SCRIPT"),
    "the product must open after strays are swept");
});

test("retailer facet labels carry department wording only, never the brand", async () => {
  const { runInNewContext: run } = await import("node:vm");
  const start = main.indexOf("function retailerFacetLabels(");
  const end = main.indexOf("async function showRetailerSearchInWindow(", start);
  const context = {};
  run(`${main.slice(start, end)}\nthis.labels = {
    ssg: retailerFacetLabels("ssg", "나이키"),
    lotte: retailerFacetLabels("lotte", "아디다스"),
    unknown: retailerFacetLabels("musinsa", "나이키"),
  };`, context);
  assert.deepEqual([...context.labels.ssg], []);
  assert.deepEqual([...context.labels.lotte], ["롯데백화점"]);
  assert.deepEqual([...context.labels.unknown], []);
});

test("store names map to their external login source", () => {
  const start = main.indexOf("function loginSourceIdForStore(");
  const end = main.indexOf("\n}\n", start) + 3;
  const context = {};
  runInNewContext(`${main.slice(start, end)}\nthis.mapped = {
    ssg: loginSourceIdForStore("SSG 백화점"),
    ssgLogin: loginSourceIdForStore("SSG·신세계백화점"),
    lotte: loginSourceIdForStore("롯데온 아울렛"),
    lotteLogin: loginSourceIdForStore("롯데온·롯데백화점"),
    musinsa: loginSourceIdForStore("무신사"),
    naver: loginSourceIdForStore("네이버 패션타운"),
    kolon: loginSourceIdForStore("코오롱몰"),
    unknown: loginSourceIdForStore("병행수입·편집샵"),
  };`, context);
  assert.deepEqual({ ...context.mapped }, {
    ssg: "ssg",
    ssgLogin: "ssg",
    lotte: "lotte",
    lotteLogin: "lotte",
    musinsa: "musinsa",
    naver: "naver",
    kolon: "kolon",
    unknown: "",
  });
});

test("each product run re-verifies the external login before searching", () => {
  const start = main.indexOf("async function verifyExternalRetailerSession(");
  assert.ok(start >= 0, "login watchdog missing");
  const end = main.indexOf("function loginSourceIdForStore(", start);
  const watchdog = main.slice(start, end);
  assert.match(watchdog, /await client\.evaluate\(EXTERNAL_LOGIN_STATE_SCRIPT\)/);
  assert.match(watchdog, /retailersNeedingLogin\.add\(sourceId\)/);
  assert.match(watchdog, /confirmedExternalLogins\.delete\(sourceId\)/);
  assert.match(watchdog, /await openRetailerLoginForSearch\(sourceId/);
  assert.match(watchdog, /checked: false/);
  // No clobbering, no fresh-login blocks, no runaway waits.
  assert.match(watchdog, /retailerMirrorChains\.has\(/);
  assert.match(watchdog, /confirmedExternalLogins\.has\(sourceId\)/);
  assert.match(watchdog, /autoTimeoutMs: 90000/);
  assert.match(watchdog, /manualTimeoutMs: 90000/);
  assert.match(main, /await verifyExternalRetailerSession\(externalSourceId/);
  assert.match(main, /canceled: \(\) => domesticSearchCanceled\(generation\)/);
});

test("mid-batch re-login stays cancelable with preserved preflight defaults", () => {
  const attemptStart = main.indexOf("async function attemptExternalRetailerLogin(");
  assert.ok(attemptStart >= 0, "external login attempt missing");
  const attemptEnd = main.indexOf("async function openRetailerLoginForSearch(", attemptStart);
  const attempt = main.slice(attemptStart, attemptEnd);
  assert.match(attempt, /autoTimeoutMs = 180000/);
  assert.match(attempt, /manualTimeoutMs = 600000/);
  assert.match(attempt, /detectControlsScript: captureShoppingLoginPage\.toString\(\),\s*\n\s*autoTimeoutMs,\s*\n\s*manualTimeoutMs,/);
  const openStart = main.indexOf("async function openRetailerLoginForSearch(");
  const openEnd = main.indexOf("async function waitForDomesticLoginsBeforeSearch(", openStart);
  const open = main.slice(openStart, openEnd);
  assert.match(open, /canceled = \(\) => false/);
  assert.match(open, /attemptExternalRetailerLogin\(sourceId, \{\s*\n?\s*onProgress, index, total, canceled, autoTimeoutMs, manualTimeoutMs,/);
});

test("the mirror leaves a per-run receipt for the finished result", () => {
  const start = main.indexOf("async function showRetailerSearchInWindow(");
  const end = main.indexOf("let shoppingAccountServicesCache;", start);
  const mirror = main.slice(start, end);
  assert.match(mirror, /retailerMirrorReceipts\.set/);
  assert.match(mirror, /receipt\.navigated = true/);
  assert.match(mirror, /receipt\.facetChecked/);
  assert.match(mirror, /receipt\.productOpened = true/);
  assert.match(mirror, /no-confirmed-login/);
  assert.match(mirror, /PRODUCT_CARD_POINT_SCRIPT\}\)\(\$\{JSON\.stringify\(article\)\}, true\)/);
  assert.match(mirror, /no-badged-card/);
  assert.match(main, /mirrorReceiptFor\(source, articleNumber/);
  assert.match(main, /mirrorReceipt: \(typeof mirrorReceiptFor/);
});

test("a visibly logged-in tab re-confirms instead of skipping every mirror", () => {
  assert.match(main, /async function importExternalLoginCookies\(sourceId, getCookies\)/);
  assert.match(main, /await importExternalLoginCookies\(sourceId, async \(\) => started\.cookies/);
  const start = main.indexOf("async function showRetailerSearchInWindow(");
  const end = main.indexOf("let shoppingAccountServicesCache;", start);
  const mirror = main.slice(start, end);
  assert.match(mirror, /mirrorPage\(\)\.evaluate\(EXTERNAL_LOGIN_STATE_SCRIPT\)/);
  assert.match(mirror, /importExternalLoginCookies\(sourceId, \(\) => mirrorPage\(\)\.getCookies/);
  assert.match(mirror, /no-shared-window/);
  assert.match(mirror, /no-confirmed-login/);
});
