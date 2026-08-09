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

test("release metadata is 2.10.129", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.129");
  assert.equal(JSON.parse(lockSource).version, "2.10.129");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.129");
});
