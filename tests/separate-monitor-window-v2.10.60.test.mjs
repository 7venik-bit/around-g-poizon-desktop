import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, html, style, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);
const normalizedMain = main.replace(/\r\n/g, "\n");

test("registration and monitoring use separate seller-center windows with one login partition", () => {
  assert.match(main, /let sellerMonitorWindow/);
  assert.match(main, /function ensureSellerMonitorWindow/);
  assert.match(main, /title: "POIZON 다운로드 감시 · Around G"/);
  const partitions = main.match(/partition: "persist:around-g-poizon-seller"/g) || [];
  assert.ok(partitions.length >= 2);
  assert.match(main, /monitorSource: "dedicated-window"/);
});

test("dedicated monitor searches every accessible frame and never reloads the registration window", () => {
  assert.match(main, /function sellerMonitorFrames/);
  assert.match(main, /mainFrame\.framesInSubtree/);
  assert.match(main, /async function readSellerMonitorStatuses/);
  assert.match(main, /frameRoutingId: frame\.routingId/);
  assert.match(main, /async function requestSellerMonitorDownload/);
  assert.match(main, /모든 다운로드센터 프레임에서 버튼을 다시 찾습니다/);
  const watchBlock = normalizedMain.match(
    /async function watchAllSellerExportJobsEveryTenSeconds[\s\S]*?\n}\n\nconst SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT/
  )?.[0] || "";
  assert.ok(watchBlock);
  assert.match(watchBlock, /ensureSellerMonitorWindow\(\)/);
  assert.match(watchBlock, /monitor\.webContents\.reloadIgnoringCache\(\)/);
  assert.doesNotMatch(watchBlock, /sellerWindow\.webContents\.reloadIgnoringCache\(\)/);
});

test("completed jobs are detected and downloaded from the live seller window as well as the hidden monitor", () => {
  assert.match(main, /\{ name: "seller", window: sellerWindow \}/);
  assert.match(main, /\{ name: "monitor", window: monitor \}/);
  assert.match(main, /windowSource: source\.name/);
  assert.match(main, /requestSellerMonitorDownload\(ready\.jobId, ready\.frameRoutingId, ready\.windowSource,/);
  assert.match(main, /action\.targetWindow\.webContents\.downloadURL\(action\.href\)/);
});

test("multi-brand UI shows registration processing completion and failure counts", () => {
  assert.match(html, /id="brand-batch-progress"/);
  assert.match(html, /id="brand-batch-summary"/);
  assert.match(html, /진행 현황 · 작업번호 생성 브랜드 목록/);
  assert.match(html, /POIZON 작업번호/);
  assert.match(renderer, /작업번호 생성 \$\{registered\}\/\$\{total\}/);
  assert.match(renderer, /createdAt: Number\(previous\.createdAt \|\| \(normalizedJobId \? Date\.now\(\) : 0\)\)/);
  assert.match(renderer, /class="brand-batch-order"/);
  assert.match(renderer, /const brandBatchStates = new Map/);
  assert.match(renderer, /작업번호 생성 \$\{registered\}\/\$\{total\} · 처리 중 \$\{processing\} · 완료 \$\{completed\} · 실패 \$\{failed\}/);
  assert.match(style, /\.brand-batch-row\.is-complete/);
  assert.match(style, /\.brand-batch-row\.is-error/);
});

test("release metadata is 2.10.217", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.217");
  assert.equal(JSON.parse(lockSource).version, "2.10.217");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.217");
});
