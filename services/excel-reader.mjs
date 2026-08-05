import readXlsxFile, { readSheet } from "read-excel-file/node";

function hasVisibleCell(rows = []) {
  return rows.some((row) => Array.isArray(row) && row.some((cell) => (
    cell !== null && cell !== undefined && String(cell).trim() !== ""
  )));
}

export async function readFirstDataSheet(input) {
  const firstSheet = await readSheet(input, 1);
  if (hasVisibleCell(firstSheet)) return firstSheet;

  const workbook = await readXlsxFile(input);
  const populatedSheet = workbook.find((sheet) => hasVisibleCell(sheet?.data));
  return Array.isArray(populatedSheet?.data) ? populatedSheet.data : firstSheet;
}
