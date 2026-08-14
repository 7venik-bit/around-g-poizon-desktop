import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("restored Excel files recover job ids from persisted file metadata", () => {
  assert.match(main, /function savedBrandExportJobForFile/);
  assert.match(main, /normalizeSavedBrandExportPath\(item\.filePath\) === pathKey/);
  assert.match(main, /item\.fileName\.toLocaleLowerCase\(\) === fileNameKey/);
  assert.match(main, /jobId: recoveredJobId/);
  assert.doesNotMatch(main, /brandIntegrity,\s*jobId: "",\s*time: info\.mtimeMs/);
});

test("future downloads persist a direct file-to-job association", () => {
  assert.match(main, /filePath: String\(input\.filePath \|\| ""\)\.trim\(\)/);
  assert.match(main, /fileName: String\(input\.fileName \|\| ""\)\.trim\(\)/);
  assert.match(main, /fileMtimeMs: Number\(input\.fileMtimeMs\) \|\| 0/);
  assert.match(main, /filePath: finalPath/);
  assert.match(main, /fileName: finalName/);
  assert.match(main, /fileMtimeMs: info\.mtimeMs/);
});

test("legacy files without any surviving cache are labeled as historical records", () => {
  assert.match(renderer, /과거 파일 · 작업번호 기록 없음/);
  assert.doesNotMatch(renderer, /작업번호 확인 불가/);
});

test("release metadata is 2.10.194", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.194");
  assert.equal(JSON.parse(lockSource).version, "2.10.194");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.194");
});
