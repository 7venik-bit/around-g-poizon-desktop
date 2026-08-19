import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const [html, style, packageText] = await Promise.all([
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);
const packageJson = JSON.parse(packageText);

test("warehouse progress uses one emoji-free illustration system", () => {
  const scene = html.match(/<div class="sorting-scene"[\s\S]*?<div class="sorted-shelf">/)?.[0] || "";
  assert.ok(scene);
  assert.doesNotMatch(scene, /🚶|🙋|📦|👟|👕|👜|🧢/u);
  assert.match(scene, /worker-sprite courier-worker/);
  assert.match(scene, /worker-sprite receiver-worker/);
  assert.doesNotMatch(scene, /warehouse-person/);
  assert.match(scene, /product-card shoe/);
  assert.match(scene, /parcel-mark/);
});

test("courier, receiver and product cards have coordinated motion", () => {
  assert.match(style, /@keyframes modern-arm-front/);
  assert.match(style, /@keyframes modern-leg-front/);
  assert.match(style, /@keyframes receiver-hand-off/);
  assert.match(style, /@keyframes modern-item-float/);
  assert.match(style, /prefers-reduced-motion:reduce/);
});

test("worker images are direct renderer assets and the delivery truck is removed", async () => {
  assert.match(html, /src="\.\/assets\/courier-worker\.png"/);
  assert.match(html, /src="\.\/assets\/receiver-worker\.png"/);
  assert.doesNotMatch(html, /delivery-truck|truck-door/);
  await access(new URL("../src/assets/courier-worker.png", import.meta.url));
  await access(new URL("../src/assets/receiver-worker.png", import.meta.url));
});

test("conveyor and receiver table share the same working height", () => {
  assert.match(style, /sorting-conveyor\{transform:none;height:58px/);
  assert.match(style, /sorting-worker\.receiver::before\{[^}]*bottom:52px/);
});
