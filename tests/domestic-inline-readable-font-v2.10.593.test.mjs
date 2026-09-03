import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("domestic result rows use readable text and an unclipped stock-watch button", async () => {
  const [css, script] = await Promise.all([
    readFile(new URL("../src/domestic-inline-results.css", import.meta.url), "utf8"),
    readFile(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8"),
  ]);
  for (const source of [css, script]) {
    assert.match(source, /\.domestic-inline-row\{[^}]*font-size:11px!important/);
    assert.match(source, /\.domestic-inline-row button\{[^}]*font-size:10px!important/);
    assert.match(source, /\.domestic-inline-row \.stock-watch-register-button\{min-width:96px!important;flex:0 0 96px!important\}/);
    assert.match(source, /grid-template-columns:120px minmax\(240px,1fr\) 130px 100px 180px!important/);
  }
});
