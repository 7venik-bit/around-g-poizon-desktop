import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

test("classified category products flow straight into the domestic batch", () => {
  const anchor = renderer.indexOf("Excel 분류를 마쳤습니다.");
  assert.notEqual(anchor, -1);
  const tail = renderer.slice(anchor, anchor + 600);
  assert.match(tail, /if \(detailProducts\.length && runId === categorySearchRunId/);
  assert.match(tail, /typeof runDomesticBatch === "function"\) await runDomesticBatch\(\);/);
});
