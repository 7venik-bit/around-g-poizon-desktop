import test from "node:test";
import assert from "node:assert/strict";
import { parseBrowserCookieImport } from "../services/browser-cookie-import.mjs";

const SSG = ["ssg.com"];

test("pasted Chrome JSON keeps only the retailer domain cookies", () => {
  const text = JSON.stringify([
    { name: "SSG_DID", value: "abc", domain: ".ssg.com", path: "/", secure: true, httpOnly: false },
    { name: "MBR", value: "x", domain: "member.ssg.com", path: "/", secure: true, httpOnly: true, expirationDate: 2000000000 },
    { name: "OTHER", value: "y", domain: ".naver.com", path: "/" },
    { name: "", value: "z", domain: ".ssg.com" },
    "not-an-object",
  ]);
  const result = parseBrowserCookieImport(text, SSG);
  assert.equal(result.error, "");
  assert.equal(result.cookies.length, 2);
  assert.equal(result.rejected, 3);
  assert.deepEqual(result.cookies.map((cookie) => cookie.name), ["SSG_DID", "MBR"]);
  assert.equal(result.cookies[0].domain, "ssg.com");
  assert.equal(result.cookies[1].httpOnly, true);
  assert.equal(result.cookies[1].expirationDate, 2000000000);
});

test("invalid JSON and subdomain lookalikes are rejected", () => {
  assert.equal(parseBrowserCookieImport("not json", SSG).error, "COOKIE_JSON_INVALID");
  assert.equal(parseBrowserCookieImport("", SSG).error, "COOKIE_EMPTY");
  assert.equal(parseBrowserCookieImport(JSON.stringify([{ name: "A", value: "1", domain: "fakessg.com" }]), SSG).cookies.length, 0);
  assert.equal(parseBrowserCookieImport(JSON.stringify([{ name: "A", value: "1", domain: "ssg.com.evil.test" }]), SSG).rejected, 1);
});

test("Netscape cookie.txt is accepted with the same domain rules", () => {
  const text = [
    "# Netscape HTTP Cookie File",
    ".ssg.com\tTRUE\t/\tTRUE\t2000000000\tSSG_DID\tabc",
    "#HttpOnly.ssg.com\tTRUE\t/\tTRUE\t2000000000\tMBR\tx",
    ".naver.com\tTRUE\t/\tTRUE\t2000000000\tOTHER\ty",
    "broken-line",
  ].join("\n");
  const result = parseBrowserCookieImport(text, SSG);
  assert.equal(result.error, "");
  assert.equal(result.cookies.length, 2);
  assert.equal(result.rejected, 1);
  assert.equal(result.cookies[0].name, "SSG_DID");
  assert.equal(result.cookies[0].httpOnly, false);
  assert.equal(result.cookies[1].httpOnly, true);
  assert.equal(result.cookies[1].expirationDate, 2000000000);
});

test("oversized entries are dropped and the count is capped", () => {
  const big = JSON.stringify([{ name: "A".repeat(5000), value: "1", domain: "ssg.com" }]);
  assert.equal(parseBrowserCookieImport(big, SSG).rejected, 1);
  const many = JSON.stringify(Array.from({ length: 250 }, (_, i) => ({ name: `C${i}`, value: "1", domain: "ssg.com" })));
  const result = parseBrowserCookieImport(many, SSG);
  assert.equal(result.cookies.length, 200);
});

test("cookie import is wired from login card to the search session", async () => {
  const { readFile } = await import("node:fs/promises");
  const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  assert.match(main, /parseBrowserCookieImport/);
  assert.match(main, /ipcMain\.handle\("domestic-login:import-cookies"/);
  assert.match(main, /DOMESTIC_SEARCH_PARTITION/);
  const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
  assert.match(preload, /importRetailerCookies/);
  const accounts = await readFile(new URL("../src/shopping-accounts.js", import.meta.url), "utf8");
  assert.match(accounts, /data-shop-cookies-apply/);
  assert.match(accounts, /importRetailerCookies/);
});
