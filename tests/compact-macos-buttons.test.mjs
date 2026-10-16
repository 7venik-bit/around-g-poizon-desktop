import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function compactBlock() {
  const start = style.indexOf("/* Compact macOS buttons:");
  assert.notEqual(start, -1);
  return style.slice(start);
}

test("generic buttons use compact macOS metrics", () => {
  assert.match(style, /html body button\{padding:6px 12px;font-size:12px;line-height:1\.4\}/);
  assert.match(style, /html body button\.primary\{font-weight:700\}/);
});

test("oversized action bars shrink while original rules stay intact", () => {
  // The original large rules remain for backward compatibility; the compact
  // overrides below must come later in the cascade.
  const legacyService = style.indexOf("html body .search-service-button{min-height:44px;");
  const compactService = style.indexOf("html body .search-service-button{min-height:32px;");
  assert.ok(legacyService >= 0 && compactService > legacyService);
  const legacyHeading = style.indexOf("min-height:42px;");
  const compactHeading = style.indexOf(".frequent-brand-heading-actions>button{min-height:30px;");
  assert.ok(legacyHeading >= 0 && compactHeading > legacyHeading);
  assert.match(style, /\.frequent-brand-heading-actions>button\{width:100%;min-width:0/);
});

test("the compact pass changes only metrics, never colors or traffic lights", () => {
  const block = compactBlock();
  assert.doesNotMatch(block, /background/);
  assert.doesNotMatch(block, /color/);
  assert.doesNotMatch(block, /traffic-lights/);
  assert.doesNotMatch(block, /!important/);
});
