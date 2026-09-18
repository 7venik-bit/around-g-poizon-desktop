import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("Naver credentials are stored with Windows encryption and excluded from portable backup", () => {
  assert.match(html, /id="naver-login-id"/);
  assert.match(html, /id="naver-password" type="password"/);
  assert.match(main, /naverPasswordEncrypted = encrypted\(config\.naverPassword\)/);
  assert.match(main, /decrypted\(settings\.naverPasswordEncrypted\)/);
  assert.match(main, /"naverLoginId", "naverPasswordEncrypted"/);
  assert.match(renderer, /hasNaverPassword/);
});

test("automatic Naver login only enters credentials on the real Naver login origin", () => {
  const start = main.indexOf("async function submitStoredNaverCredentials");
  const end = main.indexOf("function domesticLoginSourceIdsForSearch", start);
  const block = main.slice(start, end);
  assert.match(block, /current\.protocol !== "https:"/);
  assert.match(block, /current\.hostname !== "nid\.naver\.com"/);
  assert.match(block, /nidlogin\\\.login\|login/);
  assert.match(block, /NAVER_LOGIN_PAGE_NOT_CONFIRMED/);
});

test("Naver login physically fills the ID and password and reuses the persistent session", () => {
  assert.match(main, /async function submitStoredNaverCredentials\(loginWindow\)/);
  assert.match(main, /loginWindow\.webContents\.insertText\(value\)/);
  assert.match(main, /document\.getElementById\("log\.login"\)/);
  assert.match(main, /await replaceText\(fields\.id, credentials\.id\)/);
  assert.match(main, /await replaceText\(fields\.password, credentials\.password\)/);
  assert.match(main, /const inputsDeadline = Date\.now\(\) \+ 15_000/);
  assert.match(main, /if \(await hasUsableNaverLoginSession\(\)\) return \{ ok: true, submitted: true \}/);
  assert.match(main, /source\.id === "naver"/);
});

test("two-step verification remains visible and credentials are not submitted repeatedly", () => {
  assert.match(main, /NAVER_VERIFICATION_REQUIRED/);
  assert.match(main, /verificationRequired: true/);
  assert.match(main, /naverAutoLoginAttempted !== true/);
  assert.match(main, /existing\.naverAutoLoginAttempted = automatic\.ok === true \|\| automatic\.submitted === true/);
  assert.match(renderer, /상품 검색 전에 자동 로그인합니다/);
});

test("automatic preflight does not repeatedly open an empty Naver login window", () => {
  const start = main.indexOf("async function waitForDomesticLoginsBeforeSearch");
  const end = main.indexOf("async function domesticLoginStatuses", start);
  const block = main.slice(start, end);
  const credentialGuard = block.indexOf('sourceId === "naver"');
  const openWindow = block.indexOf("await openDomesticLogin");
  assert.ok(credentialGuard >= 0 && credentialGuard < openWindow);
  assert.match(block, /const credentials = naverAccountCredentials\(\)/);
  assert.match(block, /if \(credentials\.code\)[\s\S]*?continue;/);
  assert.match(block, /\{ background: sourceId === "naver" \}/);
  assert.match(main, /show: !background/);
  assert.match(main, /backgroundThrottling: false/);
  assert.match(main, /background && automatic\.ok !== true/);
});
