import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

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

function replaceRange(tag, minimum, maximum) {
  return tag
    .replace(/\bmin="[^"]*"/i, `min="${minimum}"`)
    .replace(/\bmax="[^"]*"/i, `max="${maximum}"`);
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
    if (start <= point - 1) output.push(replaceRange(tag, start, point - 1));
    start = point + 1;
  }
  if (start <= maximum) output.push(replaceRange(tag, start, maximum));
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
    layout.push({
      index: column - 1,
      hidden: definition.hidden,
      ...(widthPx === null ? {} : { widthPx }),
    });
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

  const allTags = [...remainingTags, ...changedTags]
    .sort((left, right) => Number(attribute(left, "min")) - Number(attribute(right, "min")));
  const colsXml = allTags.length ? `<cols>${allTags.join("")}</cols>` : "";
  const updated = /<cols\b[^>]*>[\s\S]*?<\/cols>/i.test(xml)
    ? xml.replace(/<cols\b[^>]*>[\s\S]*?<\/cols>/i, colsXml)
    : xml.replace(/<sheetData\b/i, `${colsXml}<sheetData`);
  archive[path] = strToU8(updated);
  return Buffer.from(zipSync(archive, { level: 6 }));
}
