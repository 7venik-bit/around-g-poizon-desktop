import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const css = (await readFile(new URL("../src/style.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("popular loading shows a radar scope without changing progress semantics", () => {
  assert.match(html, /id="popular-progress"[^>]*>[\s\S]*?class="popular-radar" aria-hidden="true"/);
  assert.match(html, /class="popular-radar-sweep"/);
  assert.equal((html.match(/class="popular-radar-blip b\d"/g) || []).length, 3);
  assert.match(html, /class="popular-radar-caption"/);
  // Truthful progress elements keep their roles.
  assert.match(html, /class="popular-progress-bar"><i><\/i><span>0%<\/span>/);
  assert.match(html, /id="popular-status"/);
});

test("radar is decorative CSS with reduced-motion and completion states", () => {
  assert.match(css, /@keyframes popular-radar-sweep/);
  assert.match(css, /@keyframes popular-radar-ping/);
  assert.match(css, /#popular-progress\[data-complete\] \.popular-radar-sweep/);
  assert.match(css, /prefers-reduced-motion:reduce[\s\S]{0,400}popular-radar-sweep/);
});

test("capture progress marks completion for the radar state", () => {
  const start = renderer.indexOf("window.aroundG.onSellerCaptureProgress((progress)");
  const end = renderer.indexOf('$("#popular-capture").addEventListener', start);
  const handler = renderer.slice(start, end);
  assert.match(handler, /toggleAttribute\("data-complete", percent >= 100\)/);
  const captureStart = renderer.indexOf("async function capturePopularProducts(");
  const captureEnd = renderer.indexOf('$("#popular-capture").addEventListener', captureStart);
  const capture = renderer.slice(captureStart, captureEnd);
  assert.match(capture, /removeAttribute\("data-complete"\)/);
  assert.match(capture, /toggleAttribute\("data-complete", verifiedPercent >= 100\)/);
});
