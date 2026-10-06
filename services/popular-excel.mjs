export const POPULAR_EXCEL_HEADERS = [
  "순위", "원본", "상품코드", "상품명", "브랜드",
  "평균 거래가", "최저 거래가", "최고 거래가", "이미지 URL", "수집 상태",
  "SPU ID",
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
      // Seller Search calls the resolved POIZON identity "SPU_ID"; brand
      // workbooks call the same value "SPU ID". Keeping the identical header
      // lets preview mapping and the product viewer reuse this column.
      { value: String(product.globalSpuId || product.spuId || "") },
    ]),
  ];
}

export function popularSpuId(product = {}) {
  return String(product?.globalSpuId || product?.spuId || "").trim();
}

// Resolve a POIZON SPU for every slot with an article number. Lookups run
// one article at a time with pacing so the open API is never burst.
// A failed lookup keeps the original slot: SPU confirmation must never
// drop or block a collected popular product.
export async function resolvePopularSpuIds(products = [], {
  lookupArticle,
  onProgress,
  waitImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  paceMs = 1050,
} = {}) {
  const list = Array.isArray(products) ? products : [];
  if (typeof lookupArticle !== "function" || !list.length) {
    return { products: list, matched: 0 };
  }
  const resolved = new Array(list.length);
  let matched = 0;
  for (let index = 0; index < list.length; index += 1) {
    const product = list[index];
    const articleNumber = String(product?.articleNumber || "").trim();
    if (articleNumber) {
      try {
        const match = await lookupArticle(articleNumber);
        const globalSpuId = String(match?.globalSpuId || "").trim();
        const spuId = String(match?.spuId || "").trim();
        if (globalSpuId || spuId) {
          matched += 1;
          resolved[index] = { ...product };
          if (globalSpuId) resolved[index].globalSpuId = globalSpuId;
          if (spuId) resolved[index].spuId = spuId;
        } else {
          resolved[index] = product;
        }
      } catch {
        resolved[index] = product;
      }
    } else {
      resolved[index] = product;
    }
    try {
      onProgress?.({ completed: index + 1, total: list.length, matched });
    } catch {
      // Progress reporting must never break SPU confirmation.
    }
    if (index < list.length - 1) {
      try {
        await waitImpl(Math.max(0, Number(paceMs) || 0));
      } catch {
        // A broken timer must not stop the remaining confirmations.
      }
    }
  }
  return { products: resolved, matched };
}

export function excelRowsToPopularProducts(rows) {
  return rows.slice(1).map((row) => {
    const rank = Number(row[0] || 0);
    const articleNumber = String(row[2] || "").trim();
    const name = String(row[3] || "").trim();
    const missingRank = String(row[9] || "") !== "완료" || (!articleNumber && !name);
    const spuId = String(row[10] || "").trim();
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
      spuId,
      globalSpuId: spuId,
      source: missingRank ? "local-excel-missing-slot" : "local-excel-roundtrip",
      sellerCenterDirect: true,
    };
  });
}
