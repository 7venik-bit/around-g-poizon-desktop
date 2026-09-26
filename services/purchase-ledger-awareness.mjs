const value = cell => String(cell?.value ?? '').trim();
const normalizedArticle = input => String(input || '').trim().toUpperCase().replace(/\s+/g, '');
const productColumns = [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13, 14];

// Use the same occupied-cell boundary as local-ledger.record. Formula and
// default-only rows are available; a partial product, note, photo or merge is not.
export function purchaseRowAvailable(sheet, row, overrides = {}) {
  if (!Number.isSafeInteger(row) || row < 3 || row > sheet.rowCount) return false;
  const index = row - 1;
  if (productColumns.some(column => {
    const cell = sheet.rawValues?.[index]?.[column];
    return value(cell) && !(column === 6 && cell?.type === 'formula');
  })) return false;
  if (sheet.images?.some(image => image.row === row)) return false;
  if (sheet.notes?.[index]?.some(Boolean)) return false;
  if (sheet.merges?.some(merge => index >= merge.row && index < merge.row + merge.rows)) return false;
  if (Object.keys(overrides).some(key => key.startsWith(`${row}:`))) return false;
  return true;
}

export function purchaseLedgerAwareness(book) {
  const sheet = book?.sheets?.find(item => item.name === '1-구매완료');
  if (!sheet) throw Error('WORKBOOK_PURCHASE_SHEET_MISSING');
  const overrides = book.local?.formulaOverrides?.[sheet.id] || {};
  const products = [];
  const freeRanges = [];
  let open = null;
  for (let row = 3; row <= sheet.rowCount; row++) {
    const cells = sheet.rawValues?.[row - 1] || [];
    const articleNumber = value(cells[2]);
    if (articleNumber && value(cells[13])) products.push({
      row, articleNumber, brand: value(cells[0]), name: value(cells[3]),
      euSize: value(cells[5]), krSize: value(cells[6]), status: value(cells[11]),
    });
    if (purchaseRowAvailable(sheet, row, overrides)) {
      if (!open) open = {start: row, end: row};
      else open.end = row;
    } else if (open) {freeRanges.push(open); open = null;}
  }
  if (open) freeRanges.push(open);
  return {
    revision: book.revision,
    sheetId: sheet.id,
    purchasedCount: products.length,
    products,
    freeRowCount: freeRanges.reduce((count, range) => count + range.end - range.start + 1, 0),
    firstFreeRow: freeRanges[0]?.start || null,
    freeRanges,
  };
}

export function purchasedRowsForArticle(awareness, articleNumber) {
  const key = normalizedArticle(articleNumber);
  return key ? (awareness?.products || []).filter(product => normalizedArticle(product.articleNumber) === key) : [];
}
