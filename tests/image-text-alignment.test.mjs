import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));

test("product images stay left with text directly to the right", () => {
  assert.match(sourcing, /data-product-image-text-alignment/);
  assert.match(sourcing, /\.candidate-summary\{/);
  assert.match(sourcing, /display:flex!important;\s*flex-direction:row!important;/);
  assert.match(sourcing, /\.sourcing-product-list-row\{/);
  assert.match(sourcing, /\.sourcing-product-thumb\{\s*flex:0 0 44px!important/);
  assert.match(sourcing, /\.sourcing-product-info\{\s*display:flex!important;\s*flex:1 1 auto!important/);
  assert.match(sourcing, /#excel-preview-grid \.excel-product-row \.excel-product-image\+td/);
});
