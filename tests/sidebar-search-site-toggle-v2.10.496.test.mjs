import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const domestic = fs.readFileSync(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");

test("sidebar exposes every domestic search group as a compact on/off control", () => {
  for (const value of ["official", "musinsa", "naver", "ssg", "lotte", "parallel", "retailers"]) {
    assert.match(html, new RegExp(`value="${value}"`));
  }
  assert.match(html, /id="search-sites-all-on"/);
  assert.match(html, /id="search-sites-all-off"/);
  assert.match(css, /\.sidebar-search-sites input:checked\+span/);
  assert.match(renderer, /sourceGroups: selectedDomesticSourceGroups\(\)/);
});

test("selected groups reach the search engine and filter actual sources", () => {
  assert.match(main, /enabledSourceGroups/);
  assert.match(domestic, /source\.retailerDiscovery \? "parallel"/);
  assert.match(domestic, /new Set\(enabledSourceGroups\)/);
  assert.match(domestic, /\.filter\(\(source\) => !enabledGroups \|\| enabledGroups\.has\(sourceGroup\(source\)\)\)/);
});
