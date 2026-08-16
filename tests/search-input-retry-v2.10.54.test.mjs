import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);



test("release metadata is 2.10.239", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.239");
  assert.equal(JSON.parse(lockSource).version, "2.10.239");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.239");
});
