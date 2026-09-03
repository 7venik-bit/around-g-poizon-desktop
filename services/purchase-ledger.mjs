import crypto from "node:crypto";

const clean = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
export function normalizePurchaseLedgerRow(input = {}) {
  const url = clean(input.purchaseUrl || input.url).replace(/[?#].*$/, "");
  const articleNumber = clean(input.articleNumber).toUpperCase().replace(/[^0-9A-Z가-힣]/g, "");
  const size = clean(input.krSize || input.euSize || input.size).toUpperCase().replace(/\s+/g, "");
  const purchasePrice = Math.max(0, Math.round(Number(String(input.purchasePrice ?? input.price ?? 0).replace(/[^0-9.-]/g, "")) || 0));
  const purchaseDate = clean(input.purchaseDate).slice(0, 10);
  return {
    platform: "무신사", brand: clean(input.brand), purchaseUrl: url,
    articleNumber, modelName: clean(input.modelName || input.name), gender: clean(input.gender),
    euSize: clean(input.euSize), krSize: clean(input.krSize || input.size), imageUrl: clean(input.imageUrl),
    status: input.status === "반품중" ? "반품중" : "구매완료", purchaseDate, purchasePrice,
    orderNumber: clean(input.orderNumber), quantity: Math.max(1, Math.round(Number(input.quantity || 1))),
    duplicateKey: clean(input.duplicateKey) || crypto.createHash("sha256")
      .update([clean(input.orderNumber), articleNumber, size, purchaseDate, purchasePrice].join("|"))
      .digest("hex").slice(0, 24),
  };
}

export function validatePurchaseLedgerRow(row = {}) {
  const missing = [];
  if (!row.modelName) missing.push("상품명");
  if (!row.articleNumber) missing.push("품번");
  if (!row.krSize && !row.euSize) missing.push("사이즈");
  if (!row.purchaseDate) missing.push("구매일자");
  if (!row.purchasePrice) missing.push("구매가");
  return { ok: missing.length === 0, missing };
}
