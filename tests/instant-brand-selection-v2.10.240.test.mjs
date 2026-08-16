import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("brand selection updates only the clicked card", () => {
  const start = renderer.indexOf("function toggleBrandSelection");
  const end = renderer.indexOf("function updateBrandSelectionControls", start);
  const source = renderer.slice(start, end);
  assert.match(source, /brandButton\.classList\.toggle\("selected", selected\)/);
  assert.match(source, /brandButton\.setAttribute\("aria-pressed", String\(selected\)\)/);
  assert.match(source, /updateBrandSelectionControls\(\)/);
  assert.doesNotMatch(source, /renderBrandCards\(/);
});

test("brand click passes its DOM card for immediate feedback", () => {
  assert.match(renderer, /toggleBrandSelection\(brandButton\.dataset\.brandId, brandButton\)/);
  assert.match(renderer, /선택됨/);
  assert.match(renderer, /선택 해제됨/);
  assert.match(style, /brand-selection-feedback/);
});
