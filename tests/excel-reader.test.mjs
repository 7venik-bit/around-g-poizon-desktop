import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import writeXlsxFile from "write-excel-file/node";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readFirstDataSheet } from "../services/excel-reader.mjs";

const stringColumn = { type: String, value: (value) => value };

test("reads real workbook rows instead of treating workbook metadata as rows", async () => {
  const folder = await mkdtemp(join(tmpdir(), "around-g-excel-reader-"));
  const filePath = join(folder, "poizon-sample.xlsx");
  try {
    await writeXlsxFile([
      { sheet: "상품 검색 결과", columns: [stringColumn, stringColumn], data: [["SPU ID", "상품명"], ["10001", "크록스 클래식 클로그"], ["10002", "크록스 에코 클로그"]] },
    ]).toFile(filePath);
    const rows = await readFirstDataSheet(await readFile(filePath));
    assert.deepEqual(rows, [["SPU ID", "상품명"], ["10001", "크록스 클래식 클로그"], ["10002", "크록스 에코 클로그"]]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("falls back to the first populated sheet when the first sheet is empty", async () => {
  const folder = await mkdtemp(join(tmpdir(), "around-g-excel-reader-"));
  const filePath = join(folder, "multi-sheet.xlsx");
  try {
    await writeXlsxFile([
      { sheet: "안내", columns: [stringColumn], data: [[""]] },
      { sheet: "데이터", columns: [stringColumn, stringColumn], data: [["SPU ID", "상품명"], ["20001", "데이터 상품"]] },
    ]).toFile(filePath);
    const rows = await readFirstDataSheet(await readFile(filePath));
    assert.deepEqual(rows, [["SPU ID", "상품명"], ["20001", "데이터 상품"]]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("repairs a POIZON worksheet whose declared dimension is incorrectly limited to A1", async () => {
  const folder = await mkdtemp(join(tmpdir(), "around-g-excel-reader-"));
  const filePath = join(folder, "poizon-a1-dimension.xlsx");
  try {
    await writeXlsxFile([
      {
        sheet: "상품 검색 결과",
        columns: [stringColumn, stringColumn, stringColumn],
        data: [
          ["SPU ID", "상품명", "브랜드"],
          ["30001", "크록스 클래식 클로그", "Crocs"],
          ["30002", "크록스 에코 클로그", "Crocs"],
        ],
      },
    ]).toFile(filePath);

    const archive = unzipSync(new Uint8Array(await readFile(filePath)));
    const worksheetPath = "xl/worksheets/sheet1.xml";
    const worksheetXml = strFromU8(archive[worksheetPath]);
    archive[worksheetPath] = strToU8(worksheetXml.replace(
      /<dimension\b[^>]*\bref="[^"]+"[^>]*\/>/i,
      '<dimension ref="A1"/>',
    ));
    const malformedWorkbook = Buffer.from(zipSync(archive, { level: 6 }));

    const rows = await readFirstDataSheet(malformedWorkbook);
    assert.deepEqual(rows, [
      ["SPU ID", "상품명", "브랜드"],
      ["30001", "크록스 클래식 클로그", "Crocs"],
      ["30002", "크록스 에코 클로그", "Crocs"],
    ]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
