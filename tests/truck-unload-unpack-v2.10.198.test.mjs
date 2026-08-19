import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, renderer, style] = await Promise.all([
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
]);

test("warehouse scene unloads a compact parcel from a delivery truck", () => {
  assert.match(html, /delivery-truck/);
  assert.match(html, /truck-door/);
  assert.match(html, /차량 하차 · 컨베이어 상차/);
  assert.match(style, /@keyframes truck-door-open/);
  assert.match(style, /@keyframes parcel-unload-to-belt/);
  assert.match(style, /\.courier-package\{[^}]*width:30px;height:22px/);
});

test("parcel travels on the belt and the receiver opens and unpacks it", () => {
  assert.match(html, /id="category-receiver"/);
  assert.match(html, /worker-sprite receiver-worker/);
  assert.doesNotMatch(html, /unpack-box/);
  assert.match(style, /warehouse-workers-v4\.png/);
  assert.match(style, /@keyframes warehouse-sprite-belt-parcel/);
  assert.match(style, /@keyframes receiver-sprite-frames/);
  assert.match(style, /background-position:100% 100%/);
  assert.match(renderer, /receiver\.classList\.add\("is-working"\)/);
});
