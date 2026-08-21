import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("POIZON credentials are entered locally and stored with Windows encryption", () => {
  assert.match(html, /id="poizon-login-id"/);
  assert.match(html, /id="poizon-password" type="password"/);
  assert.match(main, /poizonPasswordEncrypted = encrypted\(config\.poizonPassword\)/);
  assert.match(main, /decrypted\(settings\.poizonPasswordEncrypted\)/);
  assert.match(main, /"poizonLoginId", "poizonPasswordEncrypted"/);
});

test("brand search automatically resumes after stored-login submission", () => {
  assert.match(main, /submitStoredSellerCredentials/);
  assert.match(main, /ensureSellerLoginBeforeBrandSearch\(brandName\)/);
  assert.match(main, /STORED_CREDENTIALS_SUBMITTED/);
  assert.match(main, /로그인 완료 · 브랜드 검색 자동 재개/);
});

test("automatic credentials run only on a real POIZON login page", () => {
  const start = main.indexOf("async function sellerAuthenticationState");
  const end = main.indexOf("async function sellerPageRequiresLogin", start);
  const detection = main.slice(start, end);
  assert.match(detection, /login\|signin\|passport\|auth/);
  assert.match(detection, /input\[type="password"\]/);
  assert.match(detection, /getBoundingClientRect/);
  assert.doesNotMatch(detection, /!url\.startsWith/);
});

test("판매자센터의 지연된 로그인 화면을 기다린 뒤 저장 계정으로 로그인한다", () => {
  assert.match(main, /async function sellerAuthenticationState\(\)/);
  assert.match(main, /for \(const frame of sellerWindowFrames\(\)\)/);
  assert.match(main, /로그인\|登录\|登入/);
  assert.match(main, /async function waitForSellerAuthenticationState\(timeoutMs = 45_000\)/);
  assert.match(main, /const initialState = await waitForSellerAuthenticationState\(\)/);
  assert.match(main, /if \(initialState\.authenticated\) return \{ ok: true, reused: true \}/);
  assert.match(main, /if \(!initialState\.login\) return \{ ok: false, code: "SELLER_LOGIN_PAGE_TIMEOUT" \}/);
});

test("all three lamps chase in order while sourcing", () => {
  assert.match(renderer, /lamps\.classList\.toggle\("sourcing", sourcing\)/);
  assert.match(css, /\.window-dots\.sourcing i\{animation:poizon-work-lamp-chase/);
  assert.match(css, /nth-child\(2\).*animation-delay:\.18s/);
  assert.match(css, /nth-child\(3\).*animation-delay:\.36s/);
});

test("brand progress rows support checkbox selection and selected deletion", () => {
  assert.match(html, /id="brand-batch-select-all"/);
  assert.match(html, /id="brand-batch-delete"/);
  assert.match(renderer, /selectedBrandBatchKeys/);
  assert.match(renderer, /brandBatchStates\.delete\(key\)/);
});

test("Korean login form is filled from Integration settings and retried after async render", () => {
  assert.match(main, /아이디\|휴대폰\|이메일\|전화번호/);
  assert.match(main, /로그인\|登录\|登入/);
  assert.match(main, /lastAutoLoginAttemptAt/);
  assert.match(main, /Date\.now\(\) - lastAutoLoginAttemptAt >= 2_500/);
  assert.match(main, /automatic = await submitStoredSellerCredentials\(\)/);
  assert.match(renderer, /POIZON 아이디와 비밀번호를 기억했습니다/);
  assert.match(renderer, /브랜드 검색 시 자동 입력/);
});

test("login window shows verified progress and success only after seller entry", () => {
  assert.match(main, /setSellerLoginStatusOverlay/);
  assert.match(main, /저장 계정 확인 완료/);
  assert.match(main, /ID·비밀번호 자동 입력 완료/);
  assert.match(main, /자동 로그인 테스트 성공 완료/);
  assert.match(main, /POIZON 계정 저장 필요/);
  assert.match(main, /LOGIN_INPUTS_NOT_FOUND/);
  assert.match(main, /element\.shadowRoot/);
  assert.match(main, /style\.visibility !== 'hidden'/);
  assert.match(main, /await setSellerLoginStatusOverlay\("success".*seller-login-restored/s);
});

test("visually rendered POIZON fields fall back to real accessibility input", () => {
  assert.match(main, /submitStoredSellerCredentialsWithAccessibility/);
  assert.match(main, /Page\.getFrameTree/);
  assert.match(main, /Accessibility\.getFullAXTree/);
  assert.match(main, /DOM\.focus/);
  assert.match(main, /Input\.insertText/);
  assert.match(main, /ACCESSIBILITY_CREDENTIALS_SUBMITTED/);
  assert.match(main, /ID·비밀번호 실제 입력 완료/);
  assert.match(main, /accessibilityResult\?\.ok/);
});


test("blocked login DOM falls back to real mouse clicks and keyboard paste", () => {
  assert.match(main, /submitStoredSellerCredentialsWithRealMouse/);
  assert.match(main, /contents\.sendInputEvent/);
  assert.match(main, /clipboard\.readText\(\)/);
  assert.match(main, /clipboard\.writeText\(value\)/);
  assert.match(main, /await click\(0\.72, 0\.30\)/);
  assert.match(main, /await click\(0\.72, 0\.365\)/);
  assert.match(main, /await click\(0\.72, 0\.428\)/);
  assert.match(main, /REAL_MOUSE_CREDENTIALS_SUBMITTED/);
  assert.match(main, /ID·비밀번호 실제 마우스 입력 완료/);
});
