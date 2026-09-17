import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("domestic search verifies selected retailer logins before querying products", () => {
  const handler = main.slice(
    main.indexOf('ipcMain.handle("domestic:search"'),
    main.indexOf('ipcMain.handle("domestic:recovery-start"'),
  );
  const loginCheck = handler.indexOf("waitForDomesticLoginsBeforeSearch");
  const retailerQuery = handler.indexOf("queryDomesticProducts");
  assert.ok(loginCheck >= 0, "Naver login preflight is missing");
  assert.ok(retailerQuery > loginCheck, "retailer search started before login verification");
  assert.match(handler, /typeof waitForDomesticLoginsBeforeSearch === "function"/);
  assert.match(handler, /loginFailures = Array\.isArray\(loginReadiness\.failures\)/);
  assert.match(handler, /searchableSourceGroups = requestedGroups\.filter/);
  assert.match(handler, /loginErrors: loginFailures\.map/);
  assert.doesNotMatch(handler, /상품 검색을 시작하지 않았습니다/);
});

test("Naver login preflight requires the authenticated NID cookie pair", () => {
  assert.match(main, /async function hasUsableNaverLoginSession\(\)/);
  assert.match(main, /usableNames\.has\("NID_AUT"\) && usableNames\.has\("NID_SES"\)/);
  assert.match(main, /cookie\.expirationDate > now/);
});

test("missing retailer logins open the shared persistent login window sequentially", () => {
  const start = main.indexOf("async function waitForDomesticLoginsBeforeSearch");
  const end = main.indexOf("async function domesticLoginStatuses", start);
  const block = main.slice(start, end);
  assert.match(block, /await openDomesticLogin\(sourceId, \{ background: sourceId === "naver" \}\)/);
  assert.match(block, /10 \* 60_000/);
  assert.match(block, /await hasUsableDomesticLoginSession\(sourceId\)/);
  assert.match(block, /로그인 후 다음 판매처 확인을 자동으로 계속합니다/);
  assert.match(block, /NAVER_LOGIN_INPUTS_NOT_FOUND/);
  assert.ok(block.indexOf("NAVER_LOGIN_INPUTS_NOT_FOUND") < block.indexOf("const deadline = Date.now()"));
});

test("missing Naver credentials skip only Naver before opening a recurring login popup", () => {
  const start = main.indexOf("async function waitForDomesticLoginsBeforeSearch");
  const end = main.indexOf("async function domesticLoginStatuses", start);
  const block = main.slice(start, end);
  assert.ok(block.indexOf("naverAccountCredentials()") < block.indexOf("await openDomesticLogin"));
  assert.match(block, /failures\.push\(domesticLoginFailure\(source, code, message\)\)/);
  assert.match(block, /continue;/);
  assert.doesNotMatch(block, /return \{ ok: false, source, code: "NAVER_CREDENTIALS_REQUIRED"/);
  assert.match(block, /naverCredentialMessage\(code\)/);
});

test("login error codes remain attached to one source while other groups continue", () => {
  const handler = main.slice(
    main.indexOf('ipcMain.handle("domestic:search"'),
    main.indexOf('ipcMain.handle("domestic:recovery-start"'),
  );
  assert.match(handler, /enabledSourceGroups: searchableSourceGroups/);
  assert.match(handler, /errorCode: failure\.errorCode/);
  assert.match(handler, /verificationStage: failure\.verificationStage/);
  assert.match(handler, /sources: \[/);
});

test("login-required sources remain visible instead of becoming a generic search failure", async () => {
  const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  const inline = await readFile(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");
  assert.match(renderer, /!products\.length && credentialSaveRequired/);
  assert.match(renderer, /label: "네이버 계정 저장 필요"/);
  assert.match(inline, /source\?\.loginRequired \|\| source\?\.securityVerificationRequired/);
});

test("enabled source groups map only to platforms actually queried by that group", () => {
  assert.match(main, /naver: \["naver"\]/);
  assert.match(main, /musinsa: \["musinsa"\]/);
  assert.match(main, /ssg: \["ssg"\]/);
  assert.match(main, /lotte: \["lotte"\]/);
  assert.match(main, /official: DOMESTIC_LOGIN_SOURCES\.filter/);
  assert.match(main, /retailers: \[\]/);
  assert.doesNotMatch(main, /retailers: DOMESTIC_LOGIN_SOURCES\.filter/);
});

test("Kolon retailer search does not open unrelated retailer login windows", () => {
  const start = main.indexOf("function domesticLoginSourceIdsForSearch");
  const end = main.indexOf("async function hasUsableDomesticLoginSession", start);
  const block = main.slice(start, end);
  assert.match(block, /retailers: \[\]/);
  assert.doesNotMatch(block, /DOMESTIC_LOGIN_SOURCES\.map\(\(source\) => source\.id\)/);
  for (const unrelated of ["wconcept", "okmall", "abcmart", "kasina", "onthespot"]) {
    assert.doesNotMatch(block, new RegExp(`retailers:[^}]+${unrelated}`));
  }
});
