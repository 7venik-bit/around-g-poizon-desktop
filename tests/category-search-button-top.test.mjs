import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");

test("category search button sits next to select-all and clear", () => {
  const headingStart = html.indexOf('id="category-brand-section"');
  assert.notEqual(headingStart, -1);
  const heading = html.slice(headingStart, html.indexOf("</section>", headingStart));
  const selectAll = heading.indexOf('id="category-brand-select-all"');
  const clear = heading.indexOf('id="category-brand-clear"');
  const search = heading.indexOf('id="category-search"');
  assert.ok(selectAll >= 0 && clear > selectAll && search > clear);
  assert.match(html, /id="category-search" class="primary" disabled>검색/);
});

test("category bottom bar keeps only the status line", () => {
  const statusAt = html.indexOf('id="category-status"');
  assert.notEqual(statusAt, -1);
  const bar = html.slice(html.lastIndexOf("<div", statusAt), html.indexOf("</div>", statusAt));
  assert.match(bar, /id="category-status"/);
  assert.doesNotMatch(bar, /id="category-search"/);
});
