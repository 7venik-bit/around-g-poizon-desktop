import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { applyExcelColumnLayout, readExcelColumnLayout } from "../services/excel-column-layout.mjs";

function workbookBuffer() {
  return Buffer.from(zipSync({
    "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="3" width="12" customWidth="1"/></cols><sheetData><row r="1"><c r="A1"/><c r="B1"/><c r="C1"/></row></sheetData></worksheet>'),
  }));
}

test("writes hidden and resized columns into worksheet XML", () => {
  const updated = applyExcelColumnLayout(workbookBuffer(), [
    { index: 1, hidden: true },
    { index: 2, widthPx: 210, hidden: false },
  ]);
  const archive = unzipSync(new Uint8Array(updated));
  const xml = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<col[^>]+min="2"[^>]+max="2"[^>]+hidden="1"/);
  assert.match(xml, /<col[^>]+min="3"[^>]+max="3"[^>]+width="[^"]+"/);
  const layout = readExcelColumnLayout(updated, 3);
  assert.equal(layout.find((entry) => entry.index === 1)?.hidden, true);
  assert.ok(layout.find((entry) => entry.index === 2)?.widthPx >= 200);
});

test("unhides a column without deleting worksheet data", () => {
  const hidden = applyExcelColumnLayout(workbookBuffer(), [{ index: 0, hidden: true }]);
  const visible = applyExcelColumnLayout(hidden, [{ index: 0, hidden: false }]);
  const layout = readExcelColumnLayout(visible, 3);
  assert.equal(layout.find((entry) => entry.index === 0)?.hidden || false, false);
  const xml = strFromU8(unzipSync(new Uint8Array(visible))["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<sheetData>/);
});

test("desktop bootstrap and UI expose original-file column controls", async () => {
  const [packageSource, bootstrap, preload, ui] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../bootstrap.mjs", import.meta.url), "utf8"),
    readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../src/excel-column-layout.js", import.meta.url), "utf8"),
  ]);
  assert.equal(JSON.parse(packageSource).main, "bootstrap.mjs");
  assert.match(bootstrap, /excel:update-column-layout/);
  assert.match(bootstrap, /writeFile\(filePath, updated\)/);
  assert.match(preload, /getExcelColumnLayout/);
  assert.match(preload, /excel-column-layout\.js/);
  assert.match(ui, /contextmenu/);
  assert.match(ui, /pointermove/);
  assert.match(ui, /불필요 열 자동 숨김/);
  assert.match(ui, /실제 원본 Excel에도 저장했습니다/);
});
