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

test("warehouse sprite assets are included in the Windows package", () => {
  assert.ok(packageJson.build.files.includes("assets/**/*"));
});

test("warehouse sprite is colocated with the renderer stylesheet", async () => {
  assert.match(style, /url\("\.\/assets\/warehouse-workers-v5\.png"\)/);
  await access(new URL("../src/assets/warehouse-workers-v5.png", import.meta.url));
});

test("delivery truck is larger than the courier and leaves a visible handoff gap", () => {
  assert.match(style, /delivery-truck\{left:0;bottom:10px;transform:scale\(2\.3\)/);
  assert.match(style, /courier-worker\{left:205px;bottom:8px\}/);
});
