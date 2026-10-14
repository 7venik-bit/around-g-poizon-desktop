import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const css = (await readFile(new URL("../src/style.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("popular loading shows a radar scope without changing progress semantics", () => {
  assert.match(html, /id="popular-progress"[^>]*>[\s\S]*?class="popular-radar-face" aria-hidden="true"/);
  assert.match(html, /class="popular-radar-sweep"/);
  assert.doesNotMatch(html, /popular-radar-blip/);
  assert.equal((html.match(/class="popular-radar-tag"/g) || []).length, 8);
  assert.match(html, /class="popular-radar-caption"/);
  assert.match(html, /class="popular-radar-switch" role="group" aria-label="레이더 전원"/);
  assert.match(html, /data-radar-power="on" aria-pressed="true">ON/);
  assert.match(html, /data-radar-power="off" aria-pressed="false">OFF/);
  // Truthful progress elements keep their roles; collected products rise in the feed.
  assert.match(html, /class="popular-progress-bar" hidden><i><\/i><span>0%<\/span>/);
  assert.match(html, /class="popular-progress-feed"/);
  assert.match(html, /class="popular-progress-count"><b>0<\/b>/);
  assert.match(html, /class="popular-progress-items" aria-hidden="true"/);
  assert.match(html, /id="popular-status"/);
  assert.doesNotMatch(html, /popular-capture/);
  assert.match(html, /class="popular-workflow" hidden/);
});

test("radar is decorative CSS with reduced-motion and completion states", () => {
  assert.match(css, /@keyframes popular-radar-sweep/);
  assert.doesNotMatch(css, /popular-radar-blip/);
  assert.doesNotMatch(css, /popular-radar-ping/);
  assert.match(css, /#popular-progress \.popular-radar-face\{[^}]*width:min\(400px,100%\)/);
  assert.match(css, /#popular-progress \.popular-radar-tag\{[^}]*text-overflow:ellipsis/);
  assert.match(css, /#popular-progress \.popular-radar-tag\.tag-pos-11\{/);
  assert.match(css, /@keyframes popular-tag-appear/);
  assert.match(css, /#popular-progress\[data-complete\] \.popular-radar-sweep/);
  assert.match(css, /popular-radar-power\[aria-pressed="true"\]\[data-radar-power="on"\]/);
  assert.match(css, /#popular-progress\[data-radar="off"\] \.popular-radar-face/);
  assert.match(css, /#popular-progress \.popular-progress-items\{[^}]*overflow:hidden/);
  assert.match(css, /#popular-progress \.popular-progress-feed\{[^}]*max-width:680px/);
  assert.match(css, /#popular-progress \.popular-progress-feed\{[^}]*margin:10px auto 0/);
  assert.match(css, /#popular-progress \.popular-progress-item\{[^}]*height:40px/);
  assert.match(css, /#popular-progress \.popular-progress-meta\{[^}]*display:flex/);
  assert.match(css, /#popular-progress \.popular-progress-code\{/);
  assert.match(css, /#popular-progress \.popular-progress-prices\{/);
  assert.match(css, /@keyframes popular-item-rise/);
  assert.match(css, /\.popular-workflow\[hidden\]\{display:none\}/);
  assert.match(css, /prefers-reduced-motion:reduce[\s\S]{0,600}popular-radar-sweep/);
});

test("radar power switch starts capture on ON and powers down on OFF", () => {
  const start = renderer.indexOf('document.querySelectorAll("#popular-progress [data-radar-power]")');
  assert.notEqual(start, -1);
  const wiring = renderer.slice(start, start + 1200);
  assert.match(wiring, /dataset\.radarPower === "on"/);
  assert.match(wiring, /setAttribute\("data-radar", "off"\)/);
  assert.match(wiring, /typeof capturePopularProducts === "function"/);
  assert.match(wiring, /await capturePopularProducts\(\)/);
  assert.doesNotMatch(wiring, /popular-capture/);
});

test("entering popular skips the idle panel by auto-starting capture", async () => {
  const menu = await readFile(new URL("../src/search-service-menu.js", import.meta.url), "utf8");
  assert.match(menu, /button\.dataset\.serviceExplorer === "popular"/);
  assert.match(menu, /latestPopularExcelFile\?\.path/);
  assert.match(menu, /void capturePopularProducts\(\)/);
  assert.doesNotMatch(menu, /popular-capture/);
});

test("capture progress marks completion for the radar state", () => {
  const start = renderer.indexOf("window.aroundG.onSellerCaptureProgress((progress)");
  const end = renderer.indexOf('$("#popular-product-search")?.addEventListener', start);
  const handler = renderer.slice(start, end);
  assert.match(handler, /toggleAttribute\("data-complete", percent >= 100\)/);
  const captureStart = renderer.indexOf("async function capturePopularProducts(");
  const captureEnd = renderer.indexOf('$("#popular-product-search")?.addEventListener', captureStart);
  const capture = renderer.slice(captureStart, captureEnd);
  assert.match(capture, /popularCaptureRunning/);
  assert.match(capture, /workflow\.hidden = searchButton\.hidden/);
  assert.match(capture, /removeAttribute\("data-complete"\)/);
  assert.match(capture, /toggleAttribute\("data-complete", verifiedPercent >= 100\)/);
  assert.match(handler, /popular-progress-items/);
  assert.match(handler, /ownerDocument\.createElement\("div"\)/);
  assert.match(handler, /popular-progress-item/);
  assert.match(handler, /popular-progress-code/);
  assert.match(handler, /popular-progress-prices/);
  assert.match(handler, /popular-radar-tag/);
  assert.match(handler, /data-tag-slot/);
  assert.match(handler, /0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7/);
  assert.match(handler, /tag-pos-\$\{order\[slot % order\.length\]\}/);
  assert.match(handler, /void tag\.offsetWidth/);
  assert.doesNotMatch(handler, /위 수집/);
  assert.doesNotMatch(handler, /POIZON<\/span>/);
  assert.match(capture, /replaceChildren\(\)/);
});

test("collection progress carries recent products without ranks", async () => {
  const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  assert.match(main, /recent: recentConfirmedProducts\(\)/);
  assert.match(main, /articleNumber: code/);
  assert.match(main, /lowestPrice: Number\(product\.lowestPrice/);
  assert.match(main, /highestPrice: Number\(product\.highestPrice/);
  assert.doesNotMatch(main, /recentConfirmedProducts[\s\S]{0,900}rank:/);
});
