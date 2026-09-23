import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { popularTableScript } from "../services/popular-table-runtime.mjs";
import { parseSellerDomNodes } from "../services/seller-dom.mjs";
import { popularCompleteness } from "../services/popular-excel.mjs";

function board({ expanded = false, inertExpand = false, nestedFrame = false, pageScroll = false, height = 800 } = {}) {
  const dom = new JSDOM(`<main id="dashboard"><section id="other"><h2>top 브랜드</h2></section>
    <section id="popular"><header><h2>인기상품</h2><span>SPU 기준</span><span>SKU 기준</span>
      <button id="refresh" aria-label="refresh"><svg></svg></button>
      <span id="expand" class="icon-fullscreen"><svg><use href="#fullscreen"/></svg></span></header>
      <div id="viewport" style="overflow-y:auto"><div id="rows"></div></div>
      <div>상품정보 평균 거래가(KRW)</div></section>
    <section id="new"><h2>신규 인기상품</h2></section></main>`, {
    url: "https://seller.poizon.com/main/dataCenter/merchantRankBoard", runScripts: "outside-only",
  });
  const { window } = dom;
  const $ = (selector) => window.document.querySelector(selector);
  Object.defineProperties(window, { innerWidth: { value: 1200 }, innerHeight: { value: height } });
  const box = (left, top, width, h) => ({ left, top, width, height: h, right: left + width, bottom: top + h });
  let isExpanded = expanded;
  let refreshClicks = 0;
  let expandClicks = 0;
  let position = 0;
  const rowHeight = 42;
  const viewportHeight = () => height - 150;
  const panelBox = () => isExpanded ? box(20, pageScroll ? 20 - position : 20, 1160, pageScroll ? 8500 : height - 40) : box(640, 260, 540, 500);
  for (const element of window.document.querySelectorAll("*")) {
    element.getBoundingClientRect = () => box(0, 0, 1200, height);
    Object.defineProperty(element, "innerText", { get() { return this.textContent; }, configurable: true });
  }
  $("#popular").getBoundingClientRect = panelBox;
  $("#popular header").getBoundingClientRect = () => { const p = panelBox(); return box(p.left, p.top, p.width, 40); };
  $("#popular h2").getBoundingClientRect = () => { const p = panelBox(); return box(p.left + 5, p.top, 100, 30); };
  for (const id of ["expand", "refresh"]) {
    for (const element of [$("#" + id), ...$("#" + id).querySelectorAll("*")]) {
      element.getBoundingClientRect = () => { const p = panelBox(); return box(p.right - (id === "expand" ? 24 : 50), p.top + 8, 16, 16); };
    }
  }
  const viewport = $("#viewport");
  viewport.getBoundingClientRect = () => { const p = panelBox(); return box(p.left, p.top + 50, p.width, viewportHeight()); };
  Object.defineProperties(viewport, {
    clientHeight: { get: viewportHeight }, scrollHeight: { get: () => isExpanded ? 200 * rowHeight : viewportHeight() },
    scrollTop: { get: () => position, set: (value) => { position = Math.max(0, Math.min(200 * rowHeight - viewportHeight(), value)); paint(); } },
  });
  // A competing, much longer page used to win the scroll target score.
  const root = window.document.documentElement;
  Object.defineProperties(root, { clientHeight: { value: height }, scrollHeight: { value: 50000 } });
  root.scrollTop = 0;
  function paint() {
    const first = isExpanded ? Math.floor(position / rowHeight) + 1 : 1;
    const last = isExpanded ? Math.min(200, first + Math.ceil(viewportHeight() / rowHeight)) : 10;
    $("#rows").replaceChildren();
    for (let rank = first; rank <= last; rank += 1) {
      const row = window.document.createElement("div");
      row.setAttribute("role", "row");
      row.textContent = `${rank}.\nCODE-${rank}\nProduct number ${rank}\n91,720\n56,674\n153,302`;
      row.getBoundingClientRect = () => { const p = panelBox(); return box(p.left, p.top + 50 + (rank - 1) * rowHeight - (pageScroll ? 0 : position), p.width, rowHeight); };
      $("#rows").append(row);
    }
  }
  $("#expand").addEventListener("click", () => { expandClicks += 1; if (!inertExpand) { isExpanded = true; paint(); } });
  $("#refresh").addEventListener("click", () => { refreshClicks += 1; });
  if (nestedFrame) {
    // No outer-window input coordinates are available in an embedded frame.
    Object.defineProperty(window, "frameElement", { get: () => { throw Error("must not send frame-local coordinates to the outer window"); } });
  }
  paint();
  if (pageScroll) {
    viewport.style.overflowY = "visible";
    Object.defineProperty(root, "scrollTop", { get: () => position,
      set: (value) => { position = Math.max(0, Math.min(8500 - height, value)); paint(); } });
  }
  const run = (action, options) => JSON.parse(JSON.stringify(window.eval(popularTableScript(action, options))));
  return { run, window, $, viewport, root, clicks: () => ({ expandClicks, refreshClicks }), close: () => dom.window.close() };
}

test("a full-size dashboard does not prove its small popular card was expanded", () => {
  const page = board();
  assert.equal(page.run("state").expanded, false);
  assert.equal(page.run("capture").scopeVerified, false);
  assert.equal(page.run("scroll").found, false);
  assert.equal(page.root.scrollTop, 0);
  page.close();
});

test("the actual expand icon is clicked in its own frame, never the adjacent refresh button", () => {
  const page = board({ nestedFrame: true });
  assert.equal(page.run("expand").clicked, true);
  assert.equal(page.run("state").expanded, true);
  page.run("expand");
  assert.deepEqual(page.clicks(), { expandClicks: 1, refreshClicks: 0 });
  page.close();
});

test("a click that does not enlarge the panel cannot authorize capture or page scrolling", () => {
  const page = board({ inertExpand: true });
  page.run("expand");
  assert.equal(page.run("state").expanded, false);
  assert.equal(page.run("capture").scopeVerified, false);
  assert.equal(page.run("jump", { ratio: 1 }).found, false);
  assert.equal(page.root.scrollTop, 0);
  page.close();
});

for (const height of [600, 800, 1080]) {
  test(`virtualized expanded table preserves all 200 ranks at viewport height ${height}`, () => {
    const page = board({ expanded: true, height });
    const products = new Map();
    let scroll;
    let passes = 0;
    do {
      const captured = page.run("capture");
      assert.equal(captured.scopeVerified, true);
      for (const product of parseSellerDomNodes(captured.nodes)) products.set(product.rank, product);
      scroll = page.run("scroll");
      assert.equal(scroll.found, true);
      assert.ok(++passes < 50);
    } while (!scroll.atEnd);
    for (const product of parseSellerDomNodes(page.run("capture").nodes)) products.set(product.rank, product);
    assert.equal(popularCompleteness([...products.values()]).complete, true);
    assert.equal(page.root.scrollTop, 0);
    page.run("jump", { ratio: 0 });
    assert.equal(page.viewport.scrollTop, 0);
    page.run("nudge", { pixels: 42 });
    assert.equal(page.viewport.scrollTop, 42);
    page.close();
  });
}

test("unknown layout without the popular table never scrolls a different panel", () => {
  const page = board({ expanded: true });
  page.$("#popular").remove();
  assert.equal(page.run("scroll").found, false);
  assert.equal(page.root.scrollTop, 0);
  page.close();
});

test("header-mapped product cells preserve descriptive labels and numeric SKUs without shifting prices", () => {
  const page = board({ expanded: true });
  const table = page.window.document.createElement("table");
  table.innerHTML = `<thead><tr><th>순위</th><th>상품정보</th><th>검색 지수</th><th>즐겨찾기 지수</th>
    <th>평균 거래가(KRW)</th><th>최저 거래가(KRW)</th><th>최고 거래가(KRW)</th></tr></thead><tbody></tbody>`;
  const cases = [
    [39, "Dio's Enchanting Plump Lip Balm", "DIOR Enchanting Full Lips Lip Gloss 6ml", 61300, 59163, 62368],
    [48, "VN0009QC6BT1( White Lining )", "Vans Knu Skool Black White", 72843, 65347, 102718],
    [75, "AirPods Pro 3 Special Offer", "Apple AirPods Pro 3", 271002, 271002, 271002],
    [83, "416175", "GUCCI Sunglasses 2025 Edition", 196152, 170032, 234940],
    [195, "Pink Lipstick Tube", "SAINT LAURENT Pink Tube Lipsticks 3.1g", 44327, 42893, 58177],
  ];
  for (const [rank, code, name, avg, low, high] of cases) {
    const row = table.tBodies[0].insertRow();
    for (const text of [`${rank}.`, "", "9,999", "8,888", "", low.toLocaleString("en-US"), high.toLocaleString("en-US")]) row.insertCell().textContent = text;
    for (const text of [code, name]) { const span = page.window.document.createElement("span"); span.textContent = text; row.cells[1].append(span); }
    for (const text of [avg.toLocaleString("en-US"), "주간 대비", "14.34%"]) { const span = page.window.document.createElement("span"); span.textContent = text; row.cells[4].append(span); }
  }
  page.$("#rows").replaceChildren(table);
  for (const element of [table, ...table.querySelectorAll("*")]) element.getBoundingClientRect = () => ({ left: 20, top: 100, right: 1180, bottom: 140, width: 1160, height: 40 });
  const parsed = parseSellerDomNodes(page.run("capture").nodes);
  assert.equal(parsed.length, cases.length);
  for (const [rank, code, name, avg, low, high] of cases) {
    const item = parsed.find((product) => product.rank === rank);
    assert.deepEqual([item.articleNumber, item.name, item.averagePrice, item.lowestPrice, item.highestPrice], [code, name, avg, low, high]);
    assert.equal(item.articleNumberSource, "seller-product-cell");
  }
  page.close();
});

test("an expanded document scroller remains readable after its heading leaves the viewport", () => {
  const page = board({ expanded: true, pageScroll: true });
  page.run("scroll");
  page.run("scroll");
  assert.ok(page.root.scrollTop > 800);
  assert.ok(page.$("#popular h2").getBoundingClientRect().bottom < 0);
  const capture = page.run("capture");
  assert.equal(capture.scopeVerified, true);
  assert.ok(parseSellerDomNodes(capture.nodes).some((p) => p.rank > 20));
  page.close();
});

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const progressSource = renderer.slice(renderer.indexOf("window.aroundG.onSellerCaptureProgress((progress)"), renderer.indexOf('$("#popular-capture").addEventListener'));
async function progressFixture(count) {
  const dom = new JSDOM(`<button id="popular-capture"></button><button id="popular-product-search"></button>
    <div id="popular-progress"><i></i><span></span></div><div id="popular-status"></div>`, { runScripts: "outside-only" });
  const w = dom.window;
  w.$ = (selector) => w.document.querySelector(selector);
  w.latestPopularExcelFile = null;
  const products = Array.from({ length: 200 }, (_, index) => ({ rank: index + 1, missingRank: index >= count }));
  const missing = products.filter((p) => p.missingRank).map((p) => p.rank);
  w.aroundG = { onSellerCaptureProgress: (callback) => { w.report = callback; },
    captureSellerCenter: async () => ({ ok: true, partial: count < 200, products }),
    stagePopularProductsInExcel: async () => ({ ok: true, partial: count < 200, products, missing, imported: count, path: "verified.xlsx" }) };
  w.acceptSellerCenterProducts = async () => products.filter((p) => !p.missingRank);
  w.eval(progressSource);
  w.report({ percent: 100, count, target: 200, missing: missing.length });
  const before = w.$("#popular-progress span").textContent;
  const result = await w.capturePopularProducts();
  return { dom, result, before, after: w.$("#popular-progress span").textContent,
    status: w.$("#popular-status").textContent, className: w.$("#popular-status").className };
}

test("10/200 remains 5% and partial after Excel save/reread, never a green 100% success", async () => {
  const result = await progressFixture(10);
  assert.equal(result.before, "5%");
  assert.equal(result.after, "5%");
  assert.equal(result.result.partial, true);
  assert.match(result.status, /부분 수집 10\/200/);
  assert.equal(result.className, "status error");
  result.dom.window.close();
});

test("200/200 becomes complete after Excel save/reread", async () => {
  const result = await progressFixture(200);
  assert.equal(result.after, "100%");
  assert.equal(result.result.partial, false);
  assert.match(result.status, /전체 수집 완료 200\/200/);
  assert.equal(result.className, "status success");
  result.dom.window.close();
});
