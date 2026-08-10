import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("confirmed job numbers advance through the whole queue before monitoring starts", () => {
  const start = renderer.indexOf("async function exportNextSelectedBrand");
  const end = renderer.indexOf("function retainSelectedBrandName", start);
  const workflow = renderer.slice(start, end);
  const queueFinishedAt = workflow.indexOf("activeExportBrand = brandExportQueue.shift()");
  const queueFinished = workflow.slice(0, queueFinishedAt);
  const perBrand = workflow.slice(queueFinishedAt);

  assert.match(queueFinished, /startSellerBrandExportMonitor/);
  assert.doesNotMatch(perBrand, /startSellerBrandExportMonitor/);
  assert.match(perBrand, /2단계 내보내기 완료/);
  assert.match(perBrand, /await exportNextSelectedBrand\(generation\)/);
  assert.doesNotMatch(perBrand, /setTimeout\(\(\) => exportNextSelectedBrand\(generation\), 400\)/);
});

test("the renderer no longer presents download registration as step-five validation", () => {
  assert.doesNotMatch(renderer, /5단계\/5/);
  assert.doesNotMatch(renderer, /Excel 검증·프로그램 등록 중/);
});

test("step two advances to the next brand and monitoring begins after the queue", () => {
  const start = renderer.indexOf("async function exportNextSelectedBrand");
  const end = renderer.indexOf("function retainSelectedBrandName", start);
  const workflow = renderer.slice(start, end);
  const queueShift = workflow.indexOf("activeExportBrand = brandExportQueue.shift()");

  assert.match(workflow.slice(0, queueShift), /startSellerBrandExportMonitor/);
  assert.doesNotMatch(workflow.slice(queueShift), /startSellerBrandExportMonitor/);
  assert.match(workflow.slice(queueShift), /2단계 내보내기 완료/);
  assert.match(workflow.slice(queueShift), /await exportNextSelectedBrand\(generation\)/);
});
