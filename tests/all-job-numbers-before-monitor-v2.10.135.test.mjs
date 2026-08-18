import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("each brand finishes downloading before the next queued brand starts", () => {
  const start = renderer.indexOf("async function exportNextSelectedBrand");
  const end = renderer.indexOf("function retainSelectedBrandName", start);
  const workflow = renderer.slice(start, end);
  const queueFinishedAt = workflow.indexOf("activeExportBrand = brandExportQueue.shift()");
  const queueFinished = workflow.slice(0, queueFinishedAt);
  const perBrand = workflow.slice(queueFinishedAt);

  assert.doesNotMatch(queueFinished, /startSellerBrandExportMonitor/);
  assert.match(perBrand, /startSellerBrandExportMonitor/);
  assert.match(perBrand, /waitSellerBrandExportComplete/);
  assert.match(perBrand, /다운로드 완료 · 다음 브랜드를 시작합니다/);
  assert.match(perBrand, /await exportNextSelectedBrand\(generation\)/);
  assert.doesNotMatch(perBrand, /setTimeout\(\(\) => exportNextSelectedBrand\(generation\), 400\)/);
});

test("the renderer no longer presents download registration as step-five validation", () => {
  assert.doesNotMatch(renderer, /5단계\/5/);
  assert.doesNotMatch(renderer, /Excel 검증·프로그램 등록 중/);
});

test("monitoring begins per brand and only completion advances the queue", () => {
  const start = renderer.indexOf("async function exportNextSelectedBrand");
  const end = renderer.indexOf("function retainSelectedBrandName", start);
  const workflow = renderer.slice(start, end);
  const queueShift = workflow.indexOf("activeExportBrand = brandExportQueue.shift()");

  assert.doesNotMatch(workflow.slice(0, queueShift), /startSellerBrandExportMonitor/);
  assert.match(workflow.slice(queueShift), /startSellerBrandExportMonitor/);
  assert.match(workflow.slice(queueShift), /waitSellerBrandExportComplete/);
  assert.match(workflow.slice(queueShift), /await exportNextSelectedBrand\(generation\)/);
});
