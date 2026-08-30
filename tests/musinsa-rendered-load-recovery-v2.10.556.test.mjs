import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("Musinsa accepts an exact rendered result when loadURL rejects after SPA navigation", () => {
  assert.match(main, /let recoveredMusinsaResult = false;[\s\S]*if \(musinsaSource\)/);
  assert.match(main, /current\.pathname\.includes\("\/search\/goods"\)/);
  assert.match(main, /actual\.toUpperCase\(\) === expected\.toUpperCase\(\)/);
  assert.match(main, /cards > 0 \|\| explicitEmpty/);
  assert.match(main, /attempt < 8 && !recoveredMusinsaResult/);
  assert.match(main, /!documentReady && !recoveredMusinsaResult/);
});

test("Musinsa explicit empty text remains an authoritative zero-result signal", () => {
  assert.match(main, /const explicitEmpty = \/검색/);
  assert.match(main, /musinsaSettledEmpty = true/);
  assert.match(main, /absenceConfirmed: true/);
});
