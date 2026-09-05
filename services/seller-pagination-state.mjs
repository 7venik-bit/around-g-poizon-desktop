function normalizedRowText(row) {
  return String(row?.text ?? row ?? "").replace(/\s+/g, " ").trim();
}

export function sellerRowsSignature(rows = []) {
  return rows.map(normalizedRowText).filter(Boolean).join("\u241e");
}

export function sellerPaginationTransitionStatus(input = {}) {
  const expectedPage = Number(input.expectedPage || 0);
  const currentPage = Number(input.currentPage || 0);
  const rowCount = Number(input.rowCount || 0);
  if (currentPage !== expectedPage) return { ready: false, reason: "ACTIVE_PAGE_PENDING" };
  if (rowCount < 1) return { ready: false, reason: "ROWS_PENDING" };
  if (!input.currentSignature || input.currentSignature === input.previousSignature) {
    return { ready: false, reason: "ROW_UPDATE_PENDING" };
  }
  return { ready: true, reason: "PAGE_READY" };
}
