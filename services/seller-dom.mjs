const ARTICLE_PATTERN = /(?=[A-Z0-9._/-]{4,30}\b)(?=[A-Z0-9._/-]*[A-Z])(?=[A-Z0-9._/-]*\d)[A-Z0-9][A-Z0-9._/-]{3,29}/i;

function price(value) {
  const number = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function ignored(line) {
  return /주간 대비|검색 지수|즐겨찾기|거래가|검색 추세|상품정보|SPU 기준|SKU 기준/i.test(line);
}

export function parseSellerDomNodes(nodes, limit = 200) {
  const products = [];
  const seen = new Set();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const lines = String(node?.text || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (lines.length < 2 || lines.length > 40) continue;
    const codeIndex = lines.findIndex((line) => ARTICLE_PATTERN.test(line));
    if (codeIndex < 0) continue;
    const articleNumber = lines[codeIndex].match(ARTICLE_PATTERN)?.[0]?.toUpperCase() || "";
    if (!articleNumber || seen.has(articleNumber)) continue;
    const numericPrices = lines
      .filter((line) => !ARTICLE_PATTERN.test(line) && /(?:\d{1,3},)+\d{3}|\d{4,}/.test(line))
      .map(price)
      .filter((value) => value >= 1_000);
    if (!numericPrices.length) continue;
    const sameLineName = lines[codeIndex].replace(ARTICLE_PATTERN, "").trim();
    const name = (!ignored(sameLineName) && sameLineName)
      || lines.slice(codeIndex + 1).find((line) =>
      !ignored(line) && !ARTICLE_PATTERN.test(line) && !/^[\d,.%]+$/.test(line)
      ) || articleNumber;
    const rankLine = lines.slice(0, codeIndex).find((line) => /^\d{1,3}\.?$/.test(line));
    const rank = Math.min(Number(String(rankLine || products.length + 1).replace(/\D/g, "")) || products.length + 1, 999);
    seen.add(articleNumber);
    products.push({
      rank,
      articleNumber,
      name,
      averagePrice: numericPrices[0] || 0,
      lowestPrice: numericPrices[1] || 0,
      highestPrice: numericPrices[2] || 0,
      sales30d: 0,
      source: "seller-center-dom",
      logoUrl: String(node?.imageUrl || ""),
      sellerCenterDirect: true,
    });
    if (products.length >= limit) break;
  }
  return products.sort((left, right) => left.rank - right.rank);
}
