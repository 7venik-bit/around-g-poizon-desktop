import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, style] = await Promise.all([
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
]);

test("category progress removes every warehouse illustration and emoji effect", () => {
  assert.doesNotMatch(html, /sorting-scene|sorting-worker|sorting-conveyor|brand-scanner|brand-box|product-card|sorted-shelf/);
  assert.doesNotMatch(html, /courier-worker|receiver-worker|delivery-truck|parcel-mark/);
  assert.match(html, /id="category-loading-title"/);
  assert.match(html, /id="category-loading-count"/);
  assert.match(html, /id="category-loading-time"/);
  assert.match(html, /id="category-loading-bar"/);
  assert.match(html, /id="category-search-stop"/);
  assert.match(style, /category-loading-progress/);
});
