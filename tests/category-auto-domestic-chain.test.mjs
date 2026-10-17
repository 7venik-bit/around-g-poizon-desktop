import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

test("classified category products flow straight into the domestic batch", () => {
  const anchor = renderer.indexOf("Excel 분류를 마쳤습니다.");
  assert.notEqual(anchor, -1);
  const tail = renderer.slice(anchor, anchor + 1500);
  // Auto-chain now runs regardless of detailProducts.length, wrapped in its own try-catch
  // so domestic batch errors are reported separately from category search errors.
  assert.match(tail, /if \(runId === categorySearchRunId && typeof runDomesticBatch === "function"\) \{/);
  assert.match(tail, /try \{/);
  assert.match(tail, /await runDomesticBatch\(\);/);
  assert.match(tail, /catch \(domesticError\) \{/);
  // Error message uses template literal, check for key parts
  assert.match(tail, /분류 완료/);
  assert.match(tail, /국내 재고 검색 오류/);
});
