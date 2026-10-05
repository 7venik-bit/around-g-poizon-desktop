import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  chromeUserDataDir,
  chromeExecutableCandidates,
  findChromeExecutable,
  chromeProfileCopyPlan,
  chromeProfileNamesToTry,
  chromeHeadlessArguments,
  normalizeChromeCookieEntries,
  readChromeStagingCookies,
} from "../services/chrome-profile-cookies.mjs";

test("chrome locations resolve from environment without touching disk", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local", ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" };
  assert.equal(chromeUserDataDir(env), `C:\\Users\\tester\\AppData\\Local${sep}Google${sep}Chrome${sep}User Data`);
  assert.equal(chromeUserDataDir({}), "");
  const candidates = chromeExecutableCandidates(env);
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((candidate) => candidate.endsWith("chrome.exe")));
  const exists = (path) => path.includes("Program Files (x86)");
  assert.ok(findChromeExecutable(exists, candidates).includes("Program Files (x86)"));
  assert.equal(findChromeExecutable(() => false, candidates), "");
});

test("profile copy plan mirrors the cookie store layout", () => {
  const root = mkdtempSync(join(tmpdir(), "chrome-user-data-"));
  const profile = join(root, "Default", "Network");
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(root, "Local State"), "{}");
  writeFileSync(join(profile, "Cookies"), "db");
  const plan = chromeProfileCopyPlan(root, "Default", join(root, "staging"));
  assert.ok(plan.localState.endsWith("Local State"));
  assert.ok(plan.files.some((file) => file.src.endsWith(join("Network", "Cookies"))));
  assert.ok(plan.files.every((file) => file.dst.includes("staging")));
  assert.deepEqual(chromeProfileNamesToTry()[0], "Default");
});

test("headless launch arguments never touch the live profile", () => {
  const args = chromeHeadlessArguments("C:\\stage", "Default", 0);
  assert.ok(args.includes("--headless=new"));
  assert.ok(args.some((arg) => arg.startsWith("--user-data-dir=C:\\stage")));
  assert.ok(!args.join(" ").includes("LOCALAPPDATA"));
});

test("devtools cookie entries pass the same retailer-domain validation", () => {  const { cookies, rejected } = normalizeChromeCookieEntries([
    { name: "SSG_DID", value: "a", domain: ".ssg.com", path: "/", secure: true, httpOnly: false, expires: 2000000000 },
    { name: "MBR", value: "b", domain: "member.ssg.com", path: "/", secure: true, httpOnly: true, expires: -1 },
    { name: "OTHER", value: "c", domain: ".naver.com", path: "/" },
  ], ["ssg.com"]);
  assert.equal(cookies.length, 2);
  assert.equal(rejected, 1);
  assert.equal(cookies[0].expirationDate, 2000000000);
  assert.equal(cookies[1].expirationDate, undefined);
});

test("a locally launched headless Chrome yields its cookie store", async (t) => {
  if (process.platform !== "win32") t.skip("Windows Chrome only");
  const chromeExe = findChromeExecutable(
    (path) => {
      try {
        return existsSync(path);
      } catch {
        return false;
      }
    },
    chromeExecutableCandidates(process.env),
  );
  if (!chromeExe) t.skip("Chrome is not installed");
  const userDataDir = chromeUserDataDir(process.env);
  if (!userDataDir) t.skip("Chrome profile folder not found");
  let cookies;
  try {
    cookies = await readChromeStagingCookies(chromeExe, userDataDir, "Default", { timeoutMs: 45000 });
  } catch (error) {
    if (String(error?.message || error) === "CHROME_PROFILE_MISSING") t.skip("Default profile has no readable cookie store");
    throw error;
  }
  assert.ok(Array.isArray(cookies));
});
