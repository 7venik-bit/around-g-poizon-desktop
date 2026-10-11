import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

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
