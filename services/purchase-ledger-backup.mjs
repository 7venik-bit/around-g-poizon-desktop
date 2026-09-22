export const LEDGER_BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

export const PURCHASE_LEDGER_BACKUP_COLUMNS = [
  ["플랫폼", "platform"], ["브랜드", "brand"], ["상품명", "modelName"],
  ["품번", "articleNumber"], ["사이즈", "size"], ["수량", "quantity"],
  ["구매가격", "purchasePrice"], ["구매일", "purchaseDate"], ["주문번호", "orderNumber"],
  ["상태", "status"], ["구매 링크", "purchaseUrl"], ["이미지 URL", "imageUrl"],
  ["내부 장부 행", "sheetRow"], ["내부 장부 기록상태", "syncStatus"], ["마지막 기록일시", "syncedAt"],
];

export function weeklyLedgerBackupDue(lastBackupAt, now = new Date()) {
  const previous = Date.parse(String(lastBackupAt || ""));
  return !Number.isFinite(previous) || now.getTime() - previous >= LEDGER_BACKUP_INTERVAL_MS;
}

export function purchaseLedgerBackupRows(rows = []) {
  return [...rows]
    .sort((left, right) => String(right.purchaseDate || right.syncedAt || "").localeCompare(String(left.purchaseDate || left.syncedAt || "")))
    .map((row) => ({
      ...row,
      size: row.krSize || row.euSize || "",
      quantity: Math.max(1, Number(row.quantity) || 1),
      purchasePrice: Math.max(0, Number(row.purchasePrice) || 0),
    }));
}
