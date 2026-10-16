import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const verdict = readFileSync(new URL("../src/domestic-result-verdict.js", import.meta.url), "utf8");
const inline = readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");
const sourcing = readFileSync(new URL("../src/sourcing-view.js", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

// Absence shown as a result value renders "-", like other seller platforms.
// Evidence and diagnostics wording stays textual.
test("overall and row absence values render as a dash", () => {
  assert.match(verdict, /return \{ label: "-", className: "missing" \};/);
  assert.match(inline, /: \{ label: "-", className: "missing" \};/);
  assert.match(sourcing, /: \{ label: "-", className: "missing" \};/);
  assert.match(renderer, /: \{ label: "-", className: "missing" \};/);
  assert.match(renderer, /if \(source\.countVerified \|\| source\.absenceConfirmed\) return \{ label: "-", className: "missing" \};/);
  assert.match(renderer, /status\.className === "missing" \? "-" : "검색 결과"/);
  assert.match(sourcing, /source\?\.absenceConfirmed === true\s*\? "-"/);
});

test("evidence and diagnostics wording is untouched", () => {
  assert.match(verdict, /label: observedCount > 0 \? `상품 있음 ·/);
  assert.match(verdict, /: "상품 없음" \};/);
  assert.match(inline, /상태: \$\{status\}/);
  assert.match(renderer, /label: "네이버 계정 저장 필요"/);
});
