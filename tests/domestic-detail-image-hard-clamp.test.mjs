import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourcing = await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8");

test("domestic detail images are clamped at DOM insertion time", () => {
  assert.match(sourcing, /data-around-g-domestic-image-clamp/);
  assert.match(sourcing, /#excel-preview-rows \.excel-product-search-detail img/);
  assert.match(sourcing, /#explorer-product-grid \.domestic-inventory img/);
  assert.match(sourcing, /style\.setProperty\("width", "44px", "important"\)/);
  assert.match(sourcing, /style\.setProperty\("height", "44px", "important"\)/);
  assert.match(sourcing, /new MutationObserver/);
});
