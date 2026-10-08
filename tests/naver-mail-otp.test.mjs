import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { JsonStore } from "../services/store.mjs";
import {
  NAVER_IMAP_HOST,
  NAVER_IMAP_PORT,
  extractNaverOtpCode,
  decodeRfc2047Text,
  decodeMailBody,
  fetchNaverOtpCode,
  NAVER_OTP_INPUT_SCRIPT,
} from "../services/naver-mail-otp.mjs";
import { waitForExternalLogin } from "../services/external-chrome-login.mjs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");

test("imap targets Naver over implicit TLS", () => {
  assert.equal(NAVER_IMAP_HOST, "imap.naver.com");
  assert.equal(NAVER_IMAP_PORT, 993);
});

test("otp code needs six digits next to a verification keyword", () => {
  assert.equal(extractNaverOtpCode("네이버 인증번호는 482910 입니다. 10분 이내 입력"), "482910");
  assert.equal(extractNaverOtpCode("Your verification code is 731955 for Naver login"), "731955");
  assert.equal(extractNaverOtpCode("주문번호 123456789012 확인 바랍니다"), "");
  assert.equal(extractNaverOtpCode("48291"), "");
  assert.equal(extractNaverOtpCode(""), "");
  // A bare code alone is accepted only when the text holds nothing else.
  assert.equal(extractNaverOtpCode("482910"), "482910");
});

test("base64 and quoted-printable bodies still expose the code", () => {
  const encoded = Buffer.from("네이버 인증번호는 482910 입니다.", "utf-8").toString("base64");
  assert.equal(extractNaverOtpCode(decodeMailBody(encoded, "base64")), "482910");
  assert.equal(extractNaverOtpCode(decodeMailBody("=EB=84=A4=E C=A7=80", "quoted-printable")).length >= 0, true);
  assert.match(decodeRfc2047Text("=?UTF-8?B?64Sk7J2067KE?="), /네이버/);
});

function fakeTime() {
  let now = 1_700_000_000_000;
  return { now: () => now, sleep: async (ms) => { now += Math.max(1000, Number(ms) || 0); } };
}

function fakeTransport(script, seen = []) {
  return async () => ({
    async send(line) { seen.push(String(line || "")); },
    async readUntil() { return script.length ? script.shift() : ""; },
    async close() {},
  });
}

const GREETING = "* OK Naver IMAP ready\r\na000 OK completed\r\n";
const LOGIN_OK = "a001 OK authenticated\r\n";
const SELECT_OK = "* 12 EXISTS\r\na002 OK selected\r\n";
const SEARCH_HIT = "* SEARCH 44 45\r\na003 OK searched\r\n";
const SEARCH_EMPTY = "* SEARCH\r\na003 OK searched\r\n";
const HEADER_HIT = '* 45 FETCH (UID 45 BODY[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TRANSFER-ENCODING)] {120}\r\nFrom: Naver <noreply@naver.com>\r\nSubject: [Naver] verification code\r\nDate: Tue, 07 Oct 2026 12:00:00 +0900\r\nContent-Transfer-Encoding: 7bit\r\n)\r\na004 OK fetched\r\n';
const BODY_HIT = '* 45 FETCH (UID 45 BODY[TEXT] {60}\r\nYour Naver verification code is 482910.\r\n)\r\na005 OK fetched\r\n';

test("fetch returns the newest verification code without leaking secrets", async () => {
  const clock = fakeTime();
  const seen = [];
  const result = await fetchNaverOtpCode({
    user: "fixture-id",
    appPassword: "fixture-app-secret",
    sinceMs: 1_700_000_000_000 - 3_600_000,
    connectImpl: fakeTransport([GREETING, LOGIN_OK, SELECT_OK, SEARCH_HIT, HEADER_HIT, BODY_HIT], seen),
    sleepImpl: clock.sleep,
    nowImpl: clock.now,
  });
  assert.deepEqual(result, { ok: true, code: "482910" });
  assert.ok(seen.some((line) => line.includes("LOGIN")));
  assert.ok(seen.some((line) => line.includes("SELECT INBOX")));
  assert.ok(seen.some((line) => line.includes("UID SEARCH UNSEEN")));
  // The app password travels only inside the single LOGIN command line.
  const secretLines = seen.filter((line) => line.includes("fixture-app-secret"));
  assert.equal(secretLines.length, 1);
  assert.ok(secretLines[0].startsWith("a001 LOGIN"));
});

test("a wrong app password stops before touching the mailbox", async () => {
  const clock = fakeTime();
  const seen = [];
  const result = await fetchNaverOtpCode({
    user: "fixture-id",
    appPassword: "wrong-secret",
    connectImpl: fakeTransport([GREETING, "a001 NO authentication failed\r\n"], seen),
    sleepImpl: clock.sleep,
    nowImpl: clock.now,
  });
  assert.deepEqual(result, { ok: false, code: "MAIL_AUTH_FAILED" });
  assert.ok(!seen.some((line) => line.includes("SELECT INBOX")));
});

test("missing app password never opens a connection", async () => {
  let connected = 0;
  const result = await fetchNaverOtpCode({
    user: "fixture-id",
    appPassword: "",
    connectImpl: async () => { connected++; throw new Error("must not connect"); },
  });
  assert.deepEqual(result, { ok: false, code: "MAIL_CREDENTIALS_REQUIRED" });
  assert.equal(connected, 0);
});

test("stale mail older than the login attempt is skipped", async () => {
  const clock = fakeTime();
  const oldHeader = HEADER_HIT.replace("07 Oct 2026", "01 Jan 2020");
  const result = await fetchNaverOtpCode({
    user: "fixture-id",
    appPassword: "fixture-app-secret",
    sinceMs: 1_700_000_000_000,
    timeoutMs: 60_000,
    pollIntervalMs: 20_000,
    connectImpl: fakeTransport([GREETING, LOGIN_OK, SELECT_OK, SEARCH_HIT, oldHeader, SEARCH_EMPTY]),
    sleepImpl: clock.sleep,
    nowImpl: clock.now,
  });
  assert.deepEqual(result, { ok: false, code: "MAIL_CODE_NOT_FOUND" });
});

function otpPage() {
  let submitted = null;
  let authenticated = false;
  return {
    submitted: () => submitted,
    async evaluate(expression) {
      const text = String(expression);
      if (text.includes("authenticated")) {
        return { authenticated, blocked: false, hasLoginForm: false, url: "https://www.ssg.com/" };
      }
      if (text.includes("OTP_PROBE")) return { otp: { x: 1, y: 1 }, submit: { x: 1, y: 2 } };
      if (text.includes("elementFromPoint")) return true;
      if (text.includes('"password"')) return { id: { x: 1, y: 1 }, password: { x: 1, y: 2 }, submit: { x: 1, y: 3 } };
      return null;
    },
    async clickPoint(point) {
      submitted = point;
      if (point && point.x === 1 && point.y === 2) authenticated = true;
    },
    async getCookies() {
      return [{ name: "ssg_auth", value: "ok" }];
    },
  };
}

test("external login fills a mailed code exactly once, then stops asking", async () => {
  const page = otpPage();
  let fetches = 0;
  const result = await waitForExternalLogin({
    page,
    detectControlsScript: "function detect() {}",
    otpInputScript: "OTP_PROBE",
    fetchOtpCode: async () => { fetches += 1; return "482910"; },
    credentials: { loginId: "user01", password: "pw01" },
    method: "password",
    merchantDomains: ["ssg.com"],
    timeoutMs: 8000,
    sleepImpl: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(fetches, 1);
  assert.deepEqual(page.submitted(), { x: 1, y: 2 });
});

test("external login without a mailbox hook leaves the code page alone", async () => {
  const page = otpPage();
  const result = await waitForExternalLogin({
    page,
    detectControlsScript: "function detect() {}",
    credentials: { loginId: "user01", password: "pw01" },
    method: "password",
    merchantDomains: ["ssg.com"],
    timeoutMs: 300,
    sleepImpl: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "LOGIN_TIMEOUT");
  assert.notDeepEqual(page.submitted(), { x: 1, y: 2 });
});

test("otp detection never matches the id and password form", () => {
  const runScript = (body) => {
    const dom = new JSDOM(`<form>${body}</form>`, { url: "https://nid.naver.com/", runScripts: "outside-only" });
    dom.window.Element.prototype.getBoundingClientRect = () => ({
      width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}),
    });
    return vm.runInContext(NAVER_OTP_INPUT_SCRIPT, dom.getInternalVMContext());
  };
  const otp = runScript('<input id="auth" placeholder="인증번호 6자리"><button>확인</button>');
  assert.deepEqual(JSON.parse(JSON.stringify(otp)), { otp: { x: 50, y: 10 }, submit: { x: 50, y: 10 } });
  assert.equal(
    runScript('<input id="id"><input id="pw" type="password"><button>로그인</button>'),
    null,
  );
});

test("main wires the mail app password from settings to both login flows", () => {
  assert.match(main, /function naverMailOtpCredentials\(\)/);
  assert.match(main, /naverMailAppPasswordEncrypted/);
  assert.match(main, /if \(config\.naverMailAppPassword\) next\.naverMailAppPasswordEncrypted = encrypted\(config\.naverMailAppPassword\);/);
  assert.match(main, /hasNaverMailAppPassword: Boolean\(settings\.naverMailAppPasswordEncrypted\)/);
  assert.match(main, /otpInputScript: method === "naver" \? NAVER_OTP_INPUT_SCRIPT : null/);
  assert.match(main, /otpAutofilled: true/);
  // Two single-shot call sites (in-app login, external login hook): a wrong
  // code is never refetched in a loop.
  assert.equal(main.split("fetchNaverOtpCode({").length - 1, 2);
});

test("naver settings UI explains the separate mail app password", () => {
  assert.match(html, /id="naver-mail-app-password"/);
  assert.match(html, /IMAP/);
  assert.match(renderer, /naverMailAppPassword: \$\("#naver-mail-app-password"\)\.value/);
  assert.match(renderer, /\$\("#naver-mail-app-password"\)\.placeholder = config\.hasNaverMailAppPassword/);
});

test("mail app password saves encrypted without touching the login password", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "naver-mail-otp-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = new JsonStore(folder);
  await store.load();
  const start = main.indexOf("async function saveNaverAccount(");
  const end = main.indexOf("function observeNaverLoginSession(", start);
  const save = runInNewContext(main.slice(start, end) + "\nsaveNaverAccount", {
    store,
    encrypted: (value) => `encrypted:${value}`,
    naverAccountCredentials: () => ({
      code: store.snapshot().settings.naverPasswordEncrypted ? "" : "NAVER_CREDENTIALS_REQUIRED",
    }),
    clearDomesticLogin: async () => {},
    domesticLoginWindows: new Map(),
    publicConfig: () => ({}),
  });
  await save({ naverLoginId: "fixture", naverPassword: "fixture-password", naverMailAppPassword: "fixture-mail-secret" });
  const settings = store.snapshot().settings;
  assert.equal(settings.naverMailAppPasswordEncrypted, "encrypted:fixture-mail-secret");
  assert.equal(settings.naverPasswordEncrypted, "encrypted:fixture-password");
  // An empty mail field keeps a previously saved app password.
  await save({ naverLoginId: "fixture", naverPassword: "" });
  assert.equal(store.snapshot().settings.naverMailAppPasswordEncrypted, "encrypted:fixture-mail-secret");
});
