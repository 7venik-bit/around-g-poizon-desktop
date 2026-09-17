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
  assert.match(handler, /loginRequired: true/);
  assert.match(handler, /상품 검색을 시작하지 않았습니다/);
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
  assert.match(block, /await openDomesticLogin\(sourceId\)/);
  assert.match(block, /10 \* 60_000/);
  assert.match(block, /await hasUsableDomesticLoginSession\(sourceId\)/);
  assert.match(block, /로그인 후 다음 판매처 확인을 자동으로 계속합니다/);
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
