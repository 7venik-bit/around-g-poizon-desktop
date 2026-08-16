import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("selected brands can be moved to a persistent frequently-used group", () => {
  assert.match(html, /id="brand-move-top"[^>]*>선택 상단 이동</);
  assert.match(renderer, /around-g-pinned-brand-ids/);
  assert.match(renderer, /pinnedBrandIds = \[\.\.\.selected,/);
  assert.match(renderer, /pinnedOrder\.has\(Number\(left\.brand\.id\)\)/);
});

test("pinned brands are visually identified and the list scrolls to the top", () => {
  assert.match(renderer, /brand-pinned-badge/);
  assert.match(renderer, /자주사용 목록 상단에 고정했습니다/);
  assert.match(renderer, /scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
  assert.match(css, /\.brand-card\.brand-pinned/);
});
