import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const main = readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("ssg and lotte use isolated windows and profiles per retailer", () => {
  assert.match(main, /const externalRetailerChromeHandles = new Map\(\)/);
  assert.match(main, /function externalRetailerChromeHandle\(sourceId/);
  assert.match(main, /function setExternalRetailerChromeHandle\(sourceId, handle/);
  assert.match(main, /function externalRetailerUserDataDir\(sourceId/);
  assert.match(main, /"external-login", key/);
  assert.match(main, /shared: externalRetailerChromeHandle\(sourceId\)/);
  assert.match(main, /setExternalRetailerChromeHandle\(sourceId, handle\)/);
  assert.match(main, /function closeAllExternalRetailerChrome\(\)/);
  assert.match(main, /closeAllExternalRetailerChrome\(\)/);
});

test("no single shared chrome profile survives the per-retailer split", () => {
  assert.doesNotMatch(main, /let sharedExternalLoginChrome = null/);
  assert.doesNotMatch(main, /sharedExternalLoginChrome/);
  assert.doesNotMatch(main, /"external-login", "shared"/);
});

test("per-run watchdog and mirror read the retailer's own window", () => {
  const watchdogStart = main.indexOf("async function verifyExternalRetailerSession(");
  assert.ok(watchdogStart >= 0, "login watchdog missing");
  const watchdogEnd = main.indexOf("function loginSourceIdForStore(", watchdogStart);
  const watchdog = main.slice(watchdogStart, watchdogEnd);
  assert.match(watchdog, /externalRetailerChromeHandle\(sourceId\)/);
  assert.match(watchdog, /retailerHandle\?\.tabs\?\.\[sourceId\]/);

  const mirrorStart = main.indexOf("async function showRetailerSearchInWindow(");
  assert.ok(mirrorStart >= 0, "retailer mirror missing");
  const mirrorEnd = main.indexOf("let shoppingAccountServicesCache;", mirrorStart);
  const mirror = main.slice(mirrorStart, mirrorEnd);
  assert.match(mirror, /externalRetailerChromeHandle\(sourceId\)/);
  assert.match(mirror, /retailerWindow\.port/);
  assert.match(mirror, /setExternalRetailerChromeHandle\(sourceId/);
});

test("platform stores map to their own login source", () => {
  const start = main.indexOf("function loginSourceIdForStore(");
  const end = main.indexOf("\n}\n", start) + 3;
  const context = {};
  runInNewContext(`${main.slice(start, end)}\nthis.mapped = {
    ssg: loginSourceIdForStore("SSG 백화점"),
    lotte: loginSourceIdForStore("롯데온"),
    musinsa: loginSourceIdForStore("무신사"),
    naver: loginSourceIdForStore("네이버 쇼핑"),
    kolon: loginSourceIdForStore("코오롱몰"),
  };`, context);
  assert.deepEqual({ ...context.mapped }, {
    ssg: "ssg",
    lotte: "lotte",
    musinsa: "musinsa",
    naver: "naver",
    kolon: "kolon",
  });
});

test("ssg, lotte, naver, musinsa and official malls each declare a login entry", () => {
  for (const id of ["naver", "musinsa", "ssg", "lotte", "nike", "adidas"]) {
    assert.match(main, new RegExp(`\\{ id: "${id}"[^}]*domains: \\[`));
  }
  assert.match(main, /id: "ssg"[^}]*loginUrl: "https:\/\/member\.ssg\.com/);
  assert.match(main, /id: "lotte"[^}]*loginUrl: "https:\/\/www\.lotteon\.com\/p\/member\/login/);
  assert.match(main, /id: "nike"[^}]*loginUrl: "https:\/\/www\.nike\.com\/kr\/member\/profile\/login"/);
  assert.match(main, /id: "adidas"[^}]*loginUrl: "https:\/\/www\.adidas\.co\.kr\/account-login"/);
});

test("in-app login windows are kept per platform, never shared", () => {
  assert.match(main, /const domesticLoginWindows = new Map\(\)/);
  assert.match(main, /domesticLoginWindows\.get\(source\.id\)/);
  assert.match(main, /domesticLoginWindows\.set\(source\.id, loginWindow\)/);
  assert.match(main, /async function openDomesticLogin\(sourceId/);
});

test("manual platform links open in separate windows", () => {
  assert.match(main, /ipcMain\.handle\("external:open"[\s\S]*?openExternalInChromeTab\(url, \{ newWindow: true \}\)/);
  assert.match(main, /await openExternalInChromeTab\(discovery\.href, \{ newWindow: true \}\)/);
  assert.match(main, /await openExternalInChromeTab\(product\.href, \{ newWindow: true \}\)/);
  assert.match(main, /openChrome:url=>openExternalInChromeTab\(url, \{requireChrome:true,newWindow:true\}\)/);
});
