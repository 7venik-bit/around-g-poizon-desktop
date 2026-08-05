from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path, old, new):
    content = read(path)
    if old not in content:
        raise RuntimeError(f"Expected source not found in {path}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


# Keep package metadata and npm lock metadata identical so npm ci and the release tag agree.
package = json.loads(read("package.json"))
package["version"] = "2.10.44"
write("package.json", json.dumps(package, ensure_ascii=False, indent=2) + "\n")

lock = read("package-lock.json")
lock = re.sub(r'("version"\s*:\s*")2\.10\.(?:42|43)(")', r'\g<1>2.10.44\2', lock, count=2)
write("package-lock.json", lock)

service_source = r'''import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const WORKSHEET_PATH = /^xl\/worksheets\/sheet\d+\.xml$/;

function attribute(tag = "", name = "") {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "";
}

function firstWorksheetPath(archive) {
  return Object.keys(archive)
    .filter((path) => WORKSHEET_PATH.test(path))
    .sort((left, right) => Number(left.match(/sheet(\d+)/)?.[1] || 0) - Number(right.match(/sheet(\d+)/)?.[1] || 0))[0] || "";
}

function excelWidthToPixels(value) {
  const width = Number(value);
  return Number.isFinite(width) ? Math.max(24, Math.round(width * 7 + 5)) : null;
}

function pixelsToExcelWidth(value) {
  const pixels = Math.max(24, Math.min(600, Number(value) || 120));
  return Math.round(Math.max(2, (pixels - 5) / 7) * 100) / 100;
}

function cleanExtraAttributes(tag = "") {
  return tag
    .replace(/^<col\b/i, "")
    .replace(/\/?\s*>$/i, "")
    .replace(/\s+(?:min|max|width|hidden|customWidth)="[^"]*"/gi, "")
    .trim();
}

function colTag(minimum, maximum, sourceTag = "") {
  const updated = sourceTag
    .replace(/\bmin="[^"]*"/i, `min="${minimum}"`)
    .replace(/\bmax="[^"]*"/i, `max="${maximum}"`);
  return updated;
}

function columnDefinitions(xml = "") {
  const colsBody = xml.match(/<cols\b[^>]*>([\s\S]*?)<\/cols>/i)?.[1] || "";
  return [...colsBody.matchAll(/<col\b[^>]*\/?\s*>/gi)].map((match) => match[0]);
}

function effectiveDefinition(tags, columnNumber) {
  let result = { width: null, hidden: false, extra: "" };
  for (const tag of tags) {
    const minimum = Number(attribute(tag, "min"));
    const maximum = Number(attribute(tag, "max"));
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || columnNumber < minimum || columnNumber > maximum) continue;
    const width = Number(attribute(tag, "width"));
    result = {
      width: Number.isFinite(width) ? width : result.width,
      hidden: /^(?:1|true)$/i.test(attribute(tag, "hidden")),
      extra: cleanExtraAttributes(tag),
    };
  }
  return result;
}

function splitExistingTag(tag, modifiedColumns) {
  const minimum = Number(attribute(tag, "min"));
  const maximum = Number(attribute(tag, "max"));
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [tag];
  const points = modifiedColumns.filter((column) => column >= minimum && column <= maximum);
  if (!points.length) return [tag];
  const output = [];
  let start = minimum;
  for (const point of points) {
    if (start <= point - 1) output.push(colTag(start, point - 1, tag));
    start = point + 1;
  }
  if (start <= maximum) output.push(colTag(start, maximum, tag));
  return output;
}

export function readExcelColumnLayout(buffer, columnCount = 256) {
  const archive = unzipSync(new Uint8Array(buffer));
  const path = firstWorksheetPath(archive);
  if (!path) return [];
  const xml = strFromU8(archive[path]);
  const tags = columnDefinitions(xml);
  const maximumColumn = Math.max(1, Math.min(16384, Number(columnCount) || 256));
  const layout = [];
  for (let column = 1; column <= maximumColumn; column += 1) {
    const definition = effectiveDefinition(tags, column);
    const widthPx = excelWidthToPixels(definition.width);
    if (!definition.hidden && widthPx === null) continue;
    layout.push({ index: column - 1, hidden: definition.hidden, ...(widthPx === null ? {} : { widthPx }) });
  }
  return layout;
}

export function applyExcelColumnLayout(buffer, layout = []) {
  const changes = (Array.isArray(layout) ? layout : [])
    .map((entry) => ({
      index: Math.max(0, Math.min(16383, Number(entry?.index) || 0)),
      hidden: typeof entry?.hidden === "boolean" ? entry.hidden : undefined,
      widthPx: Number.isFinite(Number(entry?.widthPx)) ? Math.max(24, Math.min(600, Number(entry.widthPx))) : undefined,
    }))
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.index === entry.index) === index)
    .sort((left, right) => left.index - right.index);
  if (!changes.length) return Buffer.from(buffer);

  const archive = unzipSync(new Uint8Array(buffer));
  const path = firstWorksheetPath(archive);
  if (!path) throw new Error("Excel 워크시트를 찾지 못했습니다.");
  const xml = strFromU8(archive[path]);
  const existingTags = columnDefinitions(xml);
  const modifiedColumns = changes.map((entry) => entry.index + 1);
  const remainingTags = existingTags.flatMap((tag) => splitExistingTag(tag, modifiedColumns));
  const changedTags = changes.flatMap((change) => {
    const column = change.index + 1;
    const existing = effectiveDefinition(existingTags, column);
    const hidden = change.hidden === undefined ? existing.hidden : change.hidden;
    const width = change.widthPx === undefined ? existing.width : pixelsToExcelWidth(change.widthPx);
    const attributes = [`min="${column}"`, `max="${column}"`];
    if (width !== null && width !== undefined) attributes.push(`width="${width}"`, 'customWidth="1"');
    if (hidden) attributes.push('hidden="1"');
    if (existing.extra) attributes.push(existing.extra);
    if (!hidden && (width === null || width === undefined) && !existing.extra) return [];
    return [`<col ${attributes.join(" ")}/>`];
  });

  const allTags = [...remainingTags, ...changedTags].sort((left, right) => Number(attribute(left, "min")) - Number(attribute(right, "min")));
  const colsXml = allTags.length ? `<cols>${allTags.join("")}</cols>` : "";
  const updated = /<cols\b[^>]*>[\s\S]*?<\/cols>/i.test(xml)
    ? xml.replace(/<cols\b[^>]*>[\s\S]*?<\/cols>/i, colsXml)
    : xml.replace(/<sheetData\b/i, `${colsXml}<sheetData`);
  archive[path] = strToU8(updated);
  return Buffer.from(zipSync(archive, { level: 6 }));
}
'''
write("services/excel-column-layout.mjs", service_source)

replace_once(
    "main.mjs",
    'import { appendFile, mkdir, readFile, readdir, rename, stat } from "node:fs/promises";',
    'import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";',
)
replace_once(
    "main.mjs",
    'import { readFirstDataSheet } from "./services/excel-reader.mjs";\n',
    'import { readFirstDataSheet } from "./services/excel-reader.mjs";\nimport { applyExcelColumnLayout, readExcelColumnLayout } from "./services/excel-column-layout.mjs";\n',
)
replace_once(
    "main.mjs",
    '''    const rows = await readFirstDataSheet(await readFile(filePath));
    const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    workbook = {
      headers: Array.from({ length: columnCount }, (_unused, index) => excelPreviewCell(rows[0]?.[index]) || `열 ${index + 1}`),
      rows: rows.slice(1).map((row) => Array.from({ length: columnCount }, (_unused, index) => excelPreviewCell(row[index]))),
      columnCount,
    };''',
    '''    const fileBuffer = await readFile(filePath);
    const rows = await readFirstDataSheet(fileBuffer);
    const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    workbook = {
      headers: Array.from({ length: columnCount }, (_unused, index) => excelPreviewCell(rows[0]?.[index]) || `열 ${index + 1}`),
      rows: rows.slice(1).map((row) => Array.from({ length: columnCount }, (_unused, index) => excelPreviewCell(row[index]))),
      columnCount,
      columnLayout: readExcelColumnLayout(fileBuffer, columnCount),
    };''',
)
replace_once(
    "main.mjs",
    '    totalColumns: workbook.columnCount,\n',
    '    totalColumns: workbook.columnCount,\n    columnLayout: workbook.columnLayout,\n',
)
replace_once(
    "main.mjs",
    '\nasync function scanBrandExportFolder() {',
    '''
async function updateExcelColumnLayout(input = {}) {
  const filePath = String(input.path || "").trim();
  if (!filePath) return { ok: false, message: "파일 경로가 없습니다." };
  if (!/\\.xlsx$/i.test(filePath)) return { ok: false, message: "Excel(.xlsx) 파일만 수정할 수 있습니다." };
  const original = await readFile(filePath);
  const updated = applyExcelColumnLayout(original, input.columnLayout || []);
  await writeFile(filePath, updated);
  for (const key of [...excelPreviewCache.keys()]) {
    if (key.startsWith(`${filePath}:`)) excelPreviewCache.delete(key);
  }
  return {
    ok: true,
    path: filePath,
    columnLayout: readExcelColumnLayout(updated, Number(input.columnCount) || 256),
  };
}

async function scanBrandExportFolder() {''',
)
replace_once(
    "main.mjs",
    '''  ipcMain.handle("excel:preview", async (_event, input = {}) => {
    try {
      return await previewExcelFile(input);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });''',
    '''  ipcMain.handle("excel:preview", async (_event, input = {}) => {
    try {
      return await previewExcelFile(input);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("excel:update-column-layout", async (_event, input = {}) => {
    try {
      return await updateExcelColumnLayout(input);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });''',
)

replace_once(
    "preload.cjs",
    '  previewExcelFile: (path, offset = 0, limit = 100, filters = {}) => ipcRenderer.invoke("excel:preview", { path, offset, limit, filters }),\n',
    '  previewExcelFile: (path, offset = 0, limit = 100, filters = {}) => ipcRenderer.invoke("excel:preview", { path, offset, limit, filters }),\n  updateExcelColumnLayout: (path, columnLayout = [], columnCount = 0) => ipcRenderer.invoke("excel:update-column-layout", { path, columnLayout, columnCount }),\n',
)

replace_once(
    "src/renderer.js",
    '  activeExcelPreview = { file, offset: result.offset, limit: result.limit, totalRows, filters };',
    '  activeExcelPreview = { file, offset: result.offset, limit: result.limit, totalRows, filters, headers, rows, rowNumbers, totalColumns, columnLayout: Array.isArray(result.columnLayout) ? result.columnLayout : [] };',
)
replace_once(
    "src/renderer.js",
    '  $("#excel-preview-columns").innerHTML = `<tr><th class="excel-row-number">행</th>${headers.map((header) => `<th title="${text(header)}">${text(header)}</th>`).join("")}</tr>`;',
    '  $("#excel-preview-columns").innerHTML = `<tr><th class="excel-row-number">행</th>${headers.map((header, index) => `<th data-excel-column-index="${index}" title="${text(header)}"><span>${text(header)}</span><i class="excel-column-resizer" data-excel-resize-index="${index}" aria-hidden="true"></i></th>`).join("")}</tr>`;',
)
replace_once(
    "src/renderer.js",
    '    ? rows.map((row, index) => `<tr><th class="excel-row-number">${Number(rowNumbers[index] || result.offset + index + 2).toLocaleString("ko-KR")}</th>${row.map((cell) => `<td title="${text(cell)}">${text(cell)}</td>`).join("")}</tr>`).join("")',
    '    ? rows.map((row, index) => `<tr><th class="excel-row-number">${Number(rowNumbers[index] || result.offset + index + 2).toLocaleString("ko-KR")}</th>${row.map((cell, columnIndex) => `<td data-excel-column-index="${columnIndex}" title="${text(cell)}">${text(cell)}</td>`).join("")}</tr>`).join("")',
)
replace_once(
    "src/renderer.js",
    '    : `<tr><td class="empty" colspan="${Math.max(1, totalColumns + 1)}">표시할 데이터 행이 없습니다.</td></tr>`;\n  const totalPages',
    '    : `<tr><td class="empty" colspan="${Math.max(1, totalColumns + 1)}">표시할 데이터 행이 없습니다.</td></tr>`;\n  window.renderExcelColumnLayout?.();\n  const totalPages',
)

replace_once(
    "src/index.html",
    '  <script src="./renderer.js"></script>\n',
    '  <script src="./renderer.js"></script>\n  <script src="./excel-column-layout.js"></script>\n',
)

ui_source = r'''(() => {
  const filters = document.querySelector("#excel-preview-filters");
  if (!filters) return;

  const status = document.querySelector("#excel-filter-status");
  const commonButton = document.createElement("button");
  commonButton.id = "excel-hide-common-columns";
  commonButton.type = "button";
  commonButton.textContent = "불필요 열 자동 숨김";
  const showButton = document.createElement("button");
  showButton.id = "excel-show-hidden-columns";
  showButton.type = "button";
  showButton.textContent = "숨긴 열 모두 표시";
  showButton.hidden = true;
  filters.insertBefore(commonButton, status);
  filters.insertBefore(showButton, status);

  const menu = document.createElement("div");
  menu.id = "excel-column-menu";
  menu.className = "excel-column-menu";
  menu.hidden = true;
  menu.innerHTML = '<strong id="excel-column-menu-title">열 설정</strong><button id="excel-column-hide" type="button">이 열 숨기기</button><button id="excel-column-show-all" type="button">숨긴 열 모두 표시</button>';
  document.body.appendChild(menu);

  let contextColumnIndex = -1;
  let resizeState = null;

  function layoutEntry(index) {
    if (!activeExcelPreview) return null;
    let entry = activeExcelPreview.columnLayout.find((item) => Number(item.index) === Number(index));
    if (!entry) {
      entry = { index: Number(index), hidden: false };
      activeExcelPreview.columnLayout.push(entry);
    }
    return entry;
  }

  function visibleColumnCount() {
    if (!activeExcelPreview) return 0;
    const hidden = new Set(activeExcelPreview.columnLayout.filter((entry) => entry.hidden).map((entry) => Number(entry.index)));
    return activeExcelPreview.headers.filter((_header, index) => !hidden.has(index)).length;
  }

  function applyColumn(index) {
    if (!activeExcelPreview) return;
    const entry = activeExcelPreview.columnLayout.find((item) => Number(item.index) === Number(index));
    const hidden = Boolean(entry?.hidden);
    const width = Number(entry?.widthPx);
    document.querySelectorAll(`[data-excel-column-index="${index}"]`).forEach((cell) => {
      cell.classList.toggle("excel-column-hidden", hidden);
      if (Number.isFinite(width)) {
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
        cell.style.maxWidth = `${width}px`;
      } else {
        cell.style.removeProperty("width");
        cell.style.removeProperty("min-width");
        cell.style.removeProperty("max-width");
      }
    });
  }

  function renderLayout() {
    if (!activeExcelPreview) return;
    activeExcelPreview.headers.forEach((_header, index) => applyColumn(index));
    const hiddenCount = activeExcelPreview.columnLayout.filter((entry) => entry.hidden).length;
    showButton.hidden = hiddenCount === 0;
    menu.querySelector("#excel-column-show-all").hidden = hiddenCount === 0;
  }

  window.renderExcelColumnLayout = renderLayout;

  async function persistLayout(message) {
    if (!activeExcelPreview?.file?.path) return;
    if (status) status.textContent = "원본 Excel에 열 설정을 저장하는 중입니다.";
    const result = await window.aroundG.updateExcelColumnLayout(
      activeExcelPreview.file.path,
      activeExcelPreview.columnLayout,
      activeExcelPreview.totalColumns,
    );
    if (!result?.ok) {
      if (status) status.textContent = `열 설정 저장 실패: ${result?.message || "파일을 수정할 수 없습니다."}`;
      return;
    }
    activeExcelPreview.columnLayout = Array.isArray(result.columnLayout) ? result.columnLayout : activeExcelPreview.columnLayout;
    renderLayout();
    if (status) status.textContent = `${message} · 실제 원본 Excel에도 저장했습니다.`;
  }

  function hideColumn(index) {
    if (!activeExcelPreview || index < 0) return;
    if (visibleColumnCount() <= 1) {
      if (status) status.textContent = "마지막 표시 열은 숨길 수 없습니다.";
      return;
    }
    const entry = layoutEntry(index);
    entry.hidden = true;
    renderLayout();
    void persistLayout(`“${activeExcelPreview.headers[index] || `열 ${index + 1}`}” 열을 숨겼습니다`);
  }

  function showAllColumns() {
    if (!activeExcelPreview) return;
    activeExcelPreview.columnLayout.forEach((entry) => { entry.hidden = false; });
    renderLayout();
    void persistLayout("숨긴 열을 모두 다시 표시했습니다");
  }

  document.querySelector("#excel-preview-columns")?.addEventListener("contextmenu", (event) => {
    const header = event.target.closest("th[data-excel-column-index]");
    if (!header) return;
    event.preventDefault();
    contextColumnIndex = Number(header.dataset.excelColumnIndex);
    menu.querySelector("#excel-column-menu-title").textContent = activeExcelPreview?.headers?.[contextColumnIndex] || `열 ${contextColumnIndex + 1}`;
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 210)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 120)}px`;
    menu.hidden = false;
  });

  menu.querySelector("#excel-column-hide").addEventListener("click", () => {
    menu.hidden = true;
    hideColumn(contextColumnIndex);
  });
  menu.querySelector("#excel-column-show-all").addEventListener("click", () => {
    menu.hidden = true;
    showAllColumns();
  });
  showButton.addEventListener("click", showAllColumns);

  commonButton.addEventListener("click", () => {
    if (!activeExcelPreview) return;
    const common = /^(?:sku|seller\s*sku(?:\s*id)?)$|상품\s*출처|판매자\s*sku(?:\s*id)?|상품\s*source/i;
    let count = 0;
    activeExcelPreview.headers.forEach((header, index) => {
      if (!common.test(String(header || "").trim())) return;
      layoutEntry(index).hidden = true;
      count += 1;
    });
    if (!count) {
      if (status) status.textContent = "자동 숨김 대상 열을 찾지 못했습니다. 열 제목에서 마우스 오른쪽 버튼을 사용하세요.";
      return;
    }
    renderLayout();
    void persistLayout(`${count}개 불필요 열을 숨겼습니다`);
  });

  document.querySelector("#excel-preview-columns")?.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-excel-resize-index]");
    if (!handle || !activeExcelPreview) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(handle.dataset.excelResizeIndex);
    const header = handle.closest("th");
    resizeState = {
      index,
      startX: event.clientX,
      startWidth: Math.max(60, header.getBoundingClientRect().width),
    };
    document.body.classList.add("excel-column-resizing");
    handle.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener("pointermove", (event) => {
    if (!resizeState || !activeExcelPreview) return;
    const widthPx = Math.max(60, Math.min(600, Math.round(resizeState.startWidth + event.clientX - resizeState.startX)));
    layoutEntry(resizeState.index).widthPx = widthPx;
    applyColumn(resizeState.index);
  });

  window.addEventListener("pointerup", () => {
    if (!resizeState || !activeExcelPreview) return;
    const index = resizeState.index;
    resizeState = null;
    document.body.classList.remove("excel-column-resizing");
    void persistLayout(`“${activeExcelPreview.headers[index] || `열 ${index + 1}`}” 열 너비를 조절했습니다`);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#excel-column-menu")) menu.hidden = true;
  });
})();
'''
write("src/excel-column-layout.js", ui_source)

css = read("src/style.css")
css += r'''

/* Excel 원본 열 숨김 및 너비 조절 */
#excel-preview-filters{grid-template-columns:minmax(250px,1fr) minmax(290px,1fr) minmax(160px,.65fr) auto auto auto auto}
#excel-hide-common-columns,#excel-show-hidden-columns{height:32px;padding:6px 9px;white-space:nowrap}
.excel-preview-grid th[data-excel-column-index]{position:sticky;top:0;overflow:visible}
.excel-preview-grid th[data-excel-column-index]>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:7px}
.excel-preview-grid td[data-excel-column-index]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.excel-column-hidden{display:none!important}
.excel-column-resizer{position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;z-index:4}
.excel-column-resizer:hover{background:#2d7ff055}
.excel-column-resizing{cursor:col-resize!important;user-select:none!important}
.excel-column-menu{position:fixed;z-index:1000;display:grid;min-width:190px;padding:7px;border:1px solid #bdcbe0;border-radius:9px;background:#fff;box-shadow:0 12px 34px #203b5b33}
.excel-column-menu[hidden]{display:none}
.excel-column-menu strong{padding:7px 9px;color:#294766;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.excel-column-menu button{border:0;border-radius:6px;padding:8px 9px;background:transparent;text-align:left;color:#294766;font-size:11px}
.excel-column-menu button:hover{background:#eaf3ff;color:#1768c5}
@media(max-width:1200px){#excel-preview-filters{grid-template-columns:1fr 1fr auto auto}}
'''
write("src/style.css", css)

test_service = r'''import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { applyExcelColumnLayout, readExcelColumnLayout } from "../services/excel-column-layout.mjs";

function workbookBuffer() {
  return Buffer.from(zipSync({
    "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="3" width="12" customWidth="1"/></cols><sheetData><row r="1"><c r="A1"/><c r="B1"/><c r="C1"/></row></sheetData></worksheet>'),
  }));
}

test("writes hidden and resized columns into the original worksheet XML", () => {
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

test("can unhide a previously hidden original column without changing cell data", () => {
  const hidden = applyExcelColumnLayout(workbookBuffer(), [{ index: 0, hidden: true }]);
  const visible = applyExcelColumnLayout(hidden, [{ index: 0, hidden: false }]);
  const layout = readExcelColumnLayout(visible, 3);
  assert.equal(layout.find((entry) => entry.index === 0)?.hidden || false, false);
  const xml = strFromU8(unzipSync(new Uint8Array(visible))["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<sheetData>/);
});
'''
write("tests/excel-column-layout.test.mjs", test_service)

test_ui = r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, preload, renderer, html, ui, css] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/excel-column-layout.js", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
]);

test("Excel preview supports right-click hiding and drag resizing", () => {
  assert.match(html, /excel-column-layout\.js/);
  assert.match(renderer, /data-excel-column-index/);
  assert.match(renderer, /data-excel-resize-index/);
  assert.match(ui, /contextmenu/);
  assert.match(ui, /pointermove/);
  assert.match(ui, /불필요 열 자동 숨김/);
  assert.match(css, /excel-column-resizer/);
});

test("column layout changes are written back to the original xlsx", () => {
  assert.match(preload, /updateExcelColumnLayout/);
  assert.match(main, /excel:update-column-layout/);
  assert.match(main, /applyExcelColumnLayout/);
  assert.match(main, /writeFile\(filePath, updated\)/);
  assert.match(ui, /실제 원본 Excel에도 저장했습니다/);
});
'''
write("tests/excel-column-layout-ui.test.mjs", test_ui)

print("Applied v2.10.44 Excel column layout hotfix")
