import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, rendererSource, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);
const main = mainSource.replace(/\r\n/g, "\n");
const renderer = rendererSource.replace(/\r\n/g, "\n");

test("hidden Seller Center monitor reads connected DOM instead of visible geometry", () => {
  const reader = main.match(/async function readSellerMonitorStatuses[\s\S]*?\n}\n\nasync function requestSellerMonitorDownload/)?.[0] || "";
  assert.ok(reader);
  assert.match(reader, /element\.isConnected/);
  assert.match(reader, /element\?\.textContent \|\| element\?\.innerText/);
  assert.match(reader, /document\.querySelectorAll\("body \*"\)/);
  assert.doesNotMatch(reader, /getClientRects\(\)\.length > 0/);
});

test("hidden download request does not require a visible button", () => {
  const requester = main.match(/async function requestSellerMonitorDownload[\s\S]*?\n}\n\nfunction emitBrandExportAllComplete/)?.[0] || "";
  assert.ok(requester);
  assert.match(requester, /element\.isConnected/);
  assert.match(requester, /pointerdown/);
  assert.doesNotMatch(requester, /getClientRects\(\)\.length > 0/);
  assert.match(requester, /jobNumberMatched/);
  assert.match(requester, /workSucceeded/);
  assert.match(requester, /completionConfirmed/);
  assert.match(requester, /DOWNLOAD_CONDITIONS_NOT_MET/);
});

test("download monitoring requires matching job number, success state, and completion time", () => {
  const reader = main.match(/async function readSellerMonitorStatuses[\s\S]*?\n}\n\nasync function requestSellerMonitorDownload/)?.[0] || "";
  assert.match(reader, /const compactNumber/);
  assert.match(reader, /cellTexts\.find/);
  assert.match(reader, /const completionText = dates\.at\(-1\)/);
  assert.match(reader, /WAITING_FOR_COMPLETION/);
  assert.match(main, /status\.jobNumberMatched[\s\S]*status\.workSucceeded[\s\S]*status\.completionConfirmed/);
});

test("restored jobs recover already-completed rows by start and completion timestamps", () => {
  const reader = main.match(/async function readSellerMonitorStatuses[\s\S]*?\n}\n\nasync function requestSellerMonitorDownload/)?.[0] || "";
  const requester = main.match(/async function requestSellerMonitorDownload[\s\S]*?\n}\n\nfunction emitBrandExportAllComplete/)?.[0] || "";
  assert.match(reader, /expected\.restored && expected\.createdAt > 0/);
  assert.match(reader, /expected\.createdAt - 5 \* 60_000/);
  assert.match(reader, /expected\.createdAt \+ 60 \* 60_000/);
  assert.match(main, /recovered: Boolean\(ready\.recovered\)/);
  assert.match(requester, /rowLocator\.recovered/);
  assert.match(requester, /value\.includes\(rowLocator\.startText\)/);
  assert.match(requester, /value\.includes\(rowLocator\.completionText\)/);
});

test("all-complete is emitted once and cancels monitor restart", () => {
  assert.match(main, /let brandExportAllCompleteSent = false/);
  assert.match(main, /function emitBrandExportAllComplete/);
  assert.match(main, /clearTimeout\(brandExportMonitorRestartTimer\)/);
  assert.match(main, /if \(brandExportAllCompleteSent\) return true/);
  assert.match(main, /else emitBrandExportAllComplete\(\)/);
});

test("renderer stops activity after the final Excel import drains", () => {
  assert.match(renderer, /let brandMainAllComplete = false/);
  assert.match(renderer, /function finalizeBrandActivityAfterMainCompletion/);
  assert.match(renderer, /else finalizeBrandActivityAfterMainCompletion\(\)/);
  assert.match(renderer, /brandMainAllComplete = true/);
  assert.match(renderer, /stopBrandActivity\(\)/);
});

test("manual stop cancels automation, retries, and download monitoring immediately", () => {
  assert.match(renderer, /acceptBrandWorkEvents = false/);
  assert.match(renderer, /detectedBrandImportQueue\.length = 0/);
  assert.match(renderer, /await window\.aroundG\.stopSellerBrandWork\?\.\(\)/);
  assert.match(renderer, /brandSelectionBusy \|\| activeExportBrand \|\| hasActiveBrandExportJobs\(\)/);
  assert.match(renderer, /brandExportJobs\.set\(jobId, \{ \.\.\.job, state: "사용자 중지"/);
  assert.doesNotMatch(renderer, /이미 생성된 작업번호의 다운로드 감시는 계속합니다/);
  assert.match(main, /ipcMain\.handle\("seller:stop-brand-work"/);
  assert.match(main, /clearTimeout\(brandExportMonitorRestartTimer\)/);
  assert.match(main, /brandExportJobs\.clear\(\)/);
  assert.match(main, /await abortSellerBrandExportAttempt\(\)/);
  assert.match(main, /sellerMonitorWindow\.destroy\(\)/);
});

test("release metadata is 2.10.237", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.237");
  assert.equal(JSON.parse(lockSource).version, "2.10.237");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.237");
});
