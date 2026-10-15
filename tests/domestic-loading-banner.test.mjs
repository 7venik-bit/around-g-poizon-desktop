import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const amp = readFileSync(new URL("../src/assets/aroundg-amp.jpg", import.meta.url));

test("batch loading banner shows the amplifier photo with popular-style search info", () => {
  assert.match(renderer, /banner\.id = "domestic-loading-banner"/);
  assert.match(renderer, /src="\.\/assets\/aroundg-amp\.jpg"/);
  assert.match(renderer, /class="domestic-loading-banner-info"/);
  assert.match(renderer, /\/ \$\{Number\(searchKeys\.length\)/);
  assert.equal(amp.subarray(0, 2).toString("hex"), "ffd8");
  assert.ok(amp.length < 500 * 1024, "banner photo stays small for the installer");
});

test("banner needles, gauge bar, and tubes follow batch progress", () => {
  assert.match(renderer, /domestic-loading-banner-needle is-left/);
  assert.match(renderer, /domestic-loading-banner-needle is-right/);
  assert.match(renderer, /domestic-loading-banner-tube t1/);
  assert.match(renderer, /domestic-loading-banner-bar/);
  assert.match(renderer, /bannerBar.*style\.width = `\$\{percent\}%`/);
  assert.match(renderer, /setProperty\("--banner-percent"/);
  assert.match(renderer, /setProperty\("--tube-hue"/);
  assert.match(css, /@keyframes banner-needle-shake/);
  assert.match(css, /@keyframes banner-tube-flicker/);
  assert.match(css, /domestic-loading-banner-bar i/);
});

test("banner hides when batch search settles or stops", () => {
  assert.equal(
    (renderer.match(/\$\("#domestic-loading-banner"\)\?\.remove\(\)/g) || []).length >= 3,
    true,
  );
  assert.match(css, /#domestic-loading-banner\[hidden\]\{display:none\}/);
});
