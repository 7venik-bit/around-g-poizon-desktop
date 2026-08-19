import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, renderer, style] = await Promise.all([
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
]);

test("warehouse scene shows the courier directly without a delivery truck", () => {
  assert.doesNotMatch(html, /delivery-truck|truck-door/);
  assert.match(html, /상자 운반 · 컨베이어 상차/);
  assert.match(html, /src="\.\/assets\/courier-worker\.png"/);
});

test("parcel travels on the belt and the receiver opens and unpacks it", () => {
  assert.match(html, /id="category-receiver"/);
  assert.match(html, /worker-sprite receiver-worker/);
  assert.doesNotMatch(html, /unpack-box/);
  assert.match(html, /src="\.\/assets\/receiver-worker\.png"/);
  assert.match(style, /warehouse-sprite-belt-parcel/);
  assert.match(style, /height:58px/);
  assert.match(renderer, /receiver\.classList\.add\("is-working"\)/);
});
