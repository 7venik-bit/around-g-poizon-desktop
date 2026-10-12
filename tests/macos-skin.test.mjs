import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const indexHtml = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const inventoryHtml = fs.readFileSync(new URL("../src/inventory.html", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const inventoryCss = fs.readFileSync(new URL("../src/inventory.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const inventoryJs = fs.readFileSync(new URL("../src/inventory.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const preload = fs.readFileSync(new URL("../preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// macOS-style skin: custom frameless titlebar with traffic lights plus a
// light workspace theme. Structure-only assertions (no pixel tests).

test("main and inventory windows expose a traffic-light titlebar", () => {
  for (const [name, html] of [["index", indexHtml], ["inventory", inventoryHtml]]) {
    assert.match(html, /id="titlebar"/, name);
    for (const control of ["close", "minimize", "maximize"]) {
      assert.match(html, new RegExp(`data-window-control="${control}"`), `${name}:${control}`);
    }
  }
});

test("skin stylesheets pin a draggable titlebar with traffic lights", () => {
  for (const [name, css] of [["style", style], ["inventory", inventoryCss]]) {
    assert.match(css, /#titlebar\{[^}]*position:fixed/, name);
    assert.match(css, /-webkit-app-region:drag/, name);
    assert.match(css, /\.traffic-lights button\[data-window-control="close"\]/, name);
  }
  assert.match(style, /html body aside\{[^}]*top:46px/, "sidebar offset");
});

test("preload bridges window controls without node integration", () => {
  assert.match(preload, /windowControls: \{/);
  for (const method of ["minimize", "toggleMaximize", "close", "isMaximized", "onMaximizeChanged"]) {
    assert.match(preload, new RegExp(`\\b${method}\\b`), method);
  }
  assert.match(preload, /window:maximize-changed/);
});

test("main process runs frameless windows with control handlers", () => {
  assert.match(main, /frame: false/);
  assert.match(main, /forwardWindowFrameState\(win\)/);
  assert.match(main, /forwardWindowFrameState\(inventoryWindow\)/);
  for (const channel of ["window:minimize", "window:toggle-maximize", "window:close", "window:is-maximized"]) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\("${channel}"`), channel);
  }
  assert.match(main, /win\.on\("maximize", notify\)/);
  assert.match(main, /win\.on\("unmaximize", notify\)/);
});

test("renderers wire the traffic lights and maximize state", () => {
  for (const [name, source] of [["renderer", renderer], ["inventory", inventoryJs]]) {
    assert.match(source, /function installMacWindowControls\(\)|installMacWindowControls\(\)/, `${name}:installer`);
    assert.match(source, /data-window-control/, `${name}:wiring`);
    assert.match(source, /window-maximized/, `${name}:maximized class`);
  }
});

test("titlebar shows the renamed program title", () => {
  assert.match(indexHtml, /<p class="titlebar-title">POIZON for Around G<\/p>/);
  assert.match(indexHtml, /<title>POIZON for Around G<\/title>/);
  assert.match(main, /title: "POIZON for Around G"/);
});

test("top status and action menus are hidden with a slim header", () => {
  assert.match(style, /html body \.shell>header \.header-status-stack,\nhtml body \.shell>header \.header-actions\{display:none!important\}/);
  assert.match(style, /html body \.shell>header\{display:none!important\}/);
  assert.match(style, /html body #brand-export-completed\{display:none!important\}/);
  assert.match(style, /html body #purchase-ledger-awareness\{display:none!important\}/);
  const brandLayout = fs.readFileSync(new URL("../src/header-brand-layout.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(brandLayout, /html body \.shell>header\{display:none!important\}/);
  assert.match(brandLayout, /html body \.shell>header \.header-actions\{display:none!important\}/);
});

test("traffic lights shimmer red-yellow-green in order", () => {
  for (const [name, css] of [["style", style], ["inventory", inventoryCss]]) {
    assert.match(css, /@keyframes titlebar-running-dot/, `${name}:keyframes`);
    assert.match(css, /\.traffic-lights button\[data-window-control="minimize"\]\{animation:titlebar-running-dot[^}]*\.3s/, `${name}:sequence`);
  }
});

test("completed brands offer a delete action first", () => {
  assert.match(indexHtml, /id="completed-brand-delete"[^>]*>삭제<\/button>/);
  const heading = indexHtml.slice(
    indexHtml.indexOf("frequent-brand-heading-actions"),
    indexHtml.indexOf("frequent-brand-heading-actions") + 1200);
  assert.ok(heading.indexOf("completed-brand-delete") < heading.indexOf("completed-brand-domestic-search"));
  assert.match(renderer, /\$\("#completed-brand-delete"\)\?\.addEventListener\("click"/);
  assert.match(renderer, /trashBrandExportFiles\(unique\.map\(\(file\) => file\.path\)\)/);
});

test("sidebar backup card uses the English title", () => {
  assert.match(renderer, /One Drive Backup/);
  assert.match(indexHtml, /One Drive Backup/);
  assert.match(style, /#sidebar-quick-actions \.update-button,\n#sidebar-quick-actions \.brand-search-action/);
});

test("orders menu and view are removed", () => {
  const html = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /data-view="orders"/);
  assert.doesNotMatch(html, /id="orders"/);
  assert.doesNotMatch(html, /주문 관리/);
});

test("quick actions live at the bottom of the sidebar", () => {
  const aside = indexHtml.slice(indexHtml.indexOf("<aside>"), indexHtml.indexOf("</aside>"));
  assert.match(aside, /id="sidebar-quick-actions"/);
  assert.match(aside, /id="update-check"/);
  assert.match(aside, /id="update-panel"/);
  assert.match(aside, /id="brand-export-folder-select"/);
  assert.match(aside, /<div class="brand-export-folder-setting">/);
  const shell = indexHtml.slice(indexHtml.indexOf('<section class="shell">'));
  assert.doesNotMatch(shell, /id="update-check"/);
  assert.doesNotMatch(shell, /id="brand-export-folder-select"/);
  assert.doesNotMatch(shell, /id="brand-export-selected"/);
  assert.doesNotMatch(shell, /id="frequent-brand-export"/);
  assert.match(style, /#sidebar-quick-actions\{display:grid/);
  assert.match(style, /#sidebar-quick-actions #brand-export-selected\{display:none!important\}/);
  assert.match(style, /#sidebar-quick-actions #update-panel\{display:none!important\}/);
  assert.match(style, /#sidebar-quick-actions #poizon-review-brand-start:hover\{[^}]*border-radius:14px/);
  assert.match(style, /#sidebar-quick-actions #frequent-brand-export::before\{content:"🔍"\}/);
  assert.match(style, /justify-content:center;gap:6px;text-align:center;font-weight:800\}/);
  assert.match(style, /#backup-state-message\{display:none!important\}/);
  assert.match(style, /html body \.search-service-menu \.search-service-file-label,\nhtml body \.search-service-menu \.search-service-file\{display:none!important\}/);
  assert.match(style, /#sidebar-quick-actions #brand-export-folder-select::after\{content:none!important\}/);
  assert.match(style, /#sidebar-quick-actions \.brand-export-folder-path\{display:none!important\}/);
  assert.match(style, /#sidebar-quick-actions \.brand-search-action\{[^}]*justify-content:center/);
  assert.match(style, /html body \.search-service-button\{color:#333336\}/);
  assert.match(style, /html body \.search-service-button\[data-service-explorer="brand"\]::before\{content:"🔍"\}/);
  assert.match(style, /html body \.brand\{display:none\}/);
  assert.match(style, /html body \.search-service-menu>small\{display:none\}/);
  assert.match(style, /html body \.search-service-button\{min-height:44px;padding:11px 12px 11px 17px;font-size:13px;font-weight:650/);
});

test("hidden-header layout check skips header geometry", () => {
  const layoutScript = fs.readFileSync(new URL("../scripts/test-header-brand-layout.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(layoutScript, /headerHidden = getComputedStyle\(q\('\.shell>header'\)\)\.display === 'none'/);
  assert.match(layoutScript, /if \(!headerHidden\) \{/);
});

test("hidden chrome stays hidden through the real stylesheet cascade", () => {
  // Regression: earlier theme blocks resurrect the header with
  // `display:flex!important`. The skin hides must win the cascade, not just
  // exist as text. jsdom applies the same order, specificity and importance.
  const linked = [
    "style.css",
    "poizon-review-workspace.css",
    "retired-download-sync.css",
    "ledger-workbook.css",
    "purchase-ledger-awareness.css",
    "header-brand-layout.css",
  ];
  const combined = linked
    .map((file) => {
      try {
        return fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
  const dom = new JSDOM(`<!doctype html><html><head><style>${combined}</style></head><body>
    <section class="shell"><header>
      <div class="workspace-title"></div>
      <section class="header-status-stack"></section>
      <div class="header-actions"></div>
    </header></section>
    <details id="brand-export-completed"></details>
    <div id="purchase-ledger-awareness"></div>
    <aside><section id="sidebar-quick-actions">
      <div class="brand-export-folder-path"></div>
      <button class="brand-search-action" type="button">action</button>
    </section></aside>
  </body></html>`, { pretendToBeVisual: true });
  const computed = (selector) => dom.window.getComputedStyle(
    dom.window.document.querySelector(selector)).display;
  assert.equal(computed(".shell>header"), "none");
  assert.equal(computed(".header-status-stack"), "none");
  assert.equal(computed(".header-actions"), "none");
  assert.equal(computed(".workspace-title"), "none");
  assert.equal(computed("#brand-export-completed"), "none");
  assert.equal(computed("#purchase-ledger-awareness"), "none");
  assert.equal(computed("#sidebar-quick-actions .brand-export-folder-path"), "none");
  assert.equal(dom.window.getComputedStyle(
    dom.window.document.querySelector("#sidebar-quick-actions .brand-search-action")).justifyContent, "center");
});
