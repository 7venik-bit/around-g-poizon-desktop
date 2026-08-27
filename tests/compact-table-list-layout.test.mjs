import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourcing = await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8");

test("explorer and domestic results use compact table-like rows", () => {
  assert.match(sourcing, /#explorer-product-grid \.explorer-product-row/);
  assert.match(sourcing, /#explorer-product-grid \.product-summary img/);
  assert.match(sourcing, /#explorer-product-grid \.seller-product-info img/);
  assert.match(sourcing, /\.sourcing-product-list-row/);
  assert.match(sourcing, /max-width:44px!important/);
  assert.match(sourcing, /min-height:56px!important/);
  assert.match(sourcing, /min-height:36px!important/);
});
