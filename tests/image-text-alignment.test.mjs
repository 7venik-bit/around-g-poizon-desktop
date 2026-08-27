import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));

test("product thumbnails and adjacent text are aligned consistently", () => {
  assert.match(sourcing, /data-product-image-text-alignment/);
  assert.match(sourcing, /\.sourcing-product-list-row\{align-items:start!important\}/);
  assert.match(sourcing, /\.sourcing-product-thumb\{align-self:start!important;margin-top:0!important\}/);
  assert.match(sourcing, /\.sourcing-product-info\{align-self:start!important/);
  assert.match(sourcing, /\.candidate-summary,/);
});
