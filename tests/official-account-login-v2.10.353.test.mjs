import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("official Nike and Adidas credentials use Windows encryption", () => {
  assert.match(main, /nikePasswordEncrypted = encrypted\(config\.nikePassword\)/);
  assert.match(main, /adidasPasswordEncrypted = encrypted\(config\.adidasPassword\)/);
  assert.match(main, /hasNikePassword: Boolean\(settings\.nikePasswordEncrypted\)/);
  assert.match(main, /hasAdidasPassword: Boolean\(settings\.adidasPasswordEncrypted\)/);
  assert.match(main, /"nikeLoginId", "nikePasswordEncrypted", "adidasLoginId", "adidasPasswordEncrypted"/);
});

test("official search stops before product search when login is not verified", () => {
  assert.match(main, /ensureOfficialAccountLogin\(searchWindow, homepage\.href\)/);
  assert.match(main, /if \(!login\.ok\) return \{ ok: false, submitted: false, loginRequired: login\.required === true/);
  assert.match(main, /if \(!login\.ok\) return renderedSearchFailure\(login\.blocked \? "access_denied" : "login_required"/);
  assert.match(main, /sendInputEvent\(\{ type: "mouseDown"/);
});

test("Adidas public search reuses the current session without forcing account login", () => {
  const login = main.slice(main.indexOf("async function ensureOfficialAccountLogin"), main.indexOf("function publicConfig"));
  assert.match(login, /source\.id === "adidas" && !access\?\.loginPage/);
  assert.match(login, /return \{ ok: true, required: false, reused: true \}/);
  assert.match(login, /OFFICIAL_ACCESS_BLOCKED/);
  assert.ok(login.indexOf('source.id === "adidas"') < login.indexOf("officialAccountCredentials(source.id)"));
});

test("official internal search uses Chrome identity before opening Adidas", () => {
  const search = main.slice(main.indexOf("async function openOfficialMallInternalSearch"), main.indexOf("async function waitForDomesticCaptureReady"));
  assert.match(search, /searchWindow\.webContents\.setUserAgent\("Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\)/);
});

test("settings UI exposes both official accounts without rendering passwords", () => {
  assert.match(html, /id="nike-login-id"/);
  assert.match(html, /id="nike-password" type="password"/);
  assert.match(html, /id="adidas-login-id"/);
  assert.match(html, /id="adidas-password" type="password"/);
  assert.match(renderer, /hasNikePassword/);
  assert.match(renderer, /hasAdidasPassword/);
});
