import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [style, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("live status and job rows wrap instead of clipping", () => {
  assert.match(style, /v2\.10\.62 responsive text and overflow safeguards/);
  assert.match(style, /"Segoe UI","Malgun Gothic","Apple SD Gothic Neo"/);
  assert.match(style, /\.brand-activity-copy strong,[\s\S]*?white-space:normal/);
  assert.match(style, /\.brand-export-job-row\{[\s\S]*?grid-template-columns:minmax\(96px/);
  assert.match(style, /\.brand-export-job-state\{[\s\S]*?border-radius:12px/);
  assert.match(style, /#brand-status\{[\s\S]*?overflow-wrap:anywhere/);
});

test("batch, completed and brand-card labels remain readable", () => {
  assert.match(style, /\.brand-batch-row strong,[\s\S]*?word-break:keep-all/);
  assert.match(style, /\.brand-export-completed-row\{[\s\S]*?align-items:start/);
  assert.match(style, /\.brand-export-completed-list \{ display: grid; max-height: 220px; overflow: auto; \}/);
  assert.match(style, /\.brand-card strong\{[\s\S]*?white-space:normal/);
  assert.match(style, /\.brand-card strong\{[\s\S]*?-webkit-line-clamp:2/);
  assert.match(style, /@media\(max-width:900px\)[\s\S]*?grid-template-columns:1fr/);
});

test("release metadata is 2.10.217", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.217");
  assert.equal(JSON.parse(lockSource).version, "2.10.217");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.217");
});
