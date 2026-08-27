import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const patch = await readFile(new URL("../scripts/patch-domestic-detail-horizontal-row.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("domestic detail places text beside thumbnail in one horizontal row", () => {
  assert.match(patch, /44px minmax\(0, 1fr\) 104px/);
  assert.match(patch, /sourcing-product-info/);
  assert.match(patch, /grid-column\", \"2/);
  assert.match(patch, /sourcing-product-actions/);
  assert.match(patch, /grid-column\", \"3/);
  assert.match(patch, /MutationObserver/);
});

test("horizontal row patch is applied during install", () => {
  assert.match(packageJson.scripts.postinstall, /patch-domestic-detail-horizontal-row\.mjs/);
  assert.match(packageJson.scripts.postinstall, /verify-domestic-detail-horizontal-row\.mjs/);
});
