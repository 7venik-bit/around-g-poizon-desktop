import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, pkg, lock] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);




test("release metadata is 2.10.248", () => {
  assert.equal(JSON.parse(pkg).version, "2.10.248");
  assert.equal(JSON.parse(lock).version, "2.10.248");
  assert.equal(JSON.parse(lock).packages[""].version, "2.10.248");
});
