export const POPULAR_EXCEL_HEADERS = [
  "순위", "원본", "상품코드", "상품명", "브랜드",
  "평균 거래가", "최저 거래가", "최고 거래가", "이미지 URL", "수집 상태",
];

export function popularCompleteness(products, limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 200);
  const ranks = new Map();
  const incompleteRanks = new Set();
  const duplicateRanks = new Set();
  for (const product of Array.isArray(products) ? products : []) {
    const rank = Number(product?.rank || 0);
    const articleNumber = String(product?.articleNumber || "").trim();
    const name = String(product?.name || "").trim();
    const averagePrice = Number(product?.averagePrice || 0);
    if (rank < 1 || rank > safeLimit) continue;
    if (product?.missingRank === true || !articleNumber || !name || averagePrice <= 0) {
      incompleteRanks.add(rank);
      continue;
    }
    if (ranks.has(rank)) duplicateRanks.add(rank);
    else ranks.set(rank, product);
  }
  const missingRanks = Array.from({ length: safeLimit }, (_value, index) => index + 1)
    .filter((rank) => !ranks.has(rank));
  return {
    complete: missingRanks.length === 0 && duplicateRanks.size === 0 && ranks.size === safeLimit,
    expected: safeLimit,
    captured: ranks.size,
    missingRanks,
    incompleteRanks: [...incompleteRanks].sort((left, right) => left - right),
    duplicateRanks: [...duplicateRanks].sort((left, right) => left - right),
  };
}

export function createPopularSlots(products, limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 200);
  const byRank = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    const rank = Number(product?.rank);
    if (rank >= 1 && rank <= safeLimit && !byRank.has(rank)) byRank.set(rank, product);
  }
  return Array.from({ length: safeLimit }, (_value, index) => {
    const rank = index + 1;
    return byRank.get(rank) || { rank, missingRank: true };
  });
}

export function popularSlotsToExcelData(slots) {
  const priceCell = (value) => {
    const number = Number(value || 0);
    return number ? { value: number, format: "#,##0" } : { value: "" };
  };
  return [
    POPULAR_EXCEL_HEADERS.map((value) => ({
      value,
      fontWeight: "bold",
      backgroundColor: "#DDEEFF",
    })),
    ...slots.map((product) => [
      { value: Number(product.rank || 0) },
      { value: String(product.rawText || ""), wrap: true },
      { value: String(product.articleNumber || "") },
      { value: String(product.name || "") },
      { value: String(product.brandName || product.brand || "") },
      priceCell(product.averagePrice),
      priceCell(product.lowestPrice),
      priceCell(product.highestPrice),
      { value: String(product.logoUrl || "") },
      { value: product.missingRank ? "누락" : "완료" },
    ]),
  ];
}

export function excelRowsToPopularProducts(rows) {
  return rows.slice(1).map((row) => {
    const rank = Number(row[0] || 0);
    const articleNumber = String(row[2] || "").trim();
    const name = String(row[3] || "").trim();
    const missingRank = String(row[9] || "") !== "완료" || (!articleNumber && !name);
    return {
      rank,
      rawText: String(row[1] || ""),
      articleNumber,
      name: name || `${rank}번 상품 수집 누락`,
      brandName: String(row[4] || ""),
      averagePrice: Number(row[5] || 0),
      lowestPrice: Number(row[6] || 0),
      highestPrice: Number(row[7] || 0),
      logoUrl: String(row[8] || ""),
      missingRank,
      source: missingRank ? "local-excel-missing-slot" : "local-excel-roundtrip",
      sellerCenterDirect: true,
    };
  });
}
