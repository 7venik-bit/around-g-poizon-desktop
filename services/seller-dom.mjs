const ARTICLE_PATTERN = /(?=[A-Z0-9._/-]{4,30}\b)(?=[A-Z0-9._/-]*[A-Z])(?=[A-Z0-9._/-]*\d)[A-Z0-9][A-Z0-9._/-]{3,29}/i;
const ARTICLE_LINE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{2,39}$/i;
const COMPOUND_ARTICLE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{2,39}(?:\s+[A-Z0-9][A-Z0-9._/-]{0,19}){1,3}$/i;
const MEASUREMENT_PATTERN = /^\d+(?:\.\d+)?\s*(?:MM|CM|M|IN|INCH|G|KG|ML|L)$/i;

function price(value) {
  const number = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function ignored(line) {
  return /주간 대비|검색 지수|즐겨찾기|거래가|검색 추세|상품정보|SPU 기준|SKU 기준/i.test(line);
}

export function sellerRankFromLine(line, limit = 200) {
  const value = String(line || "").replace(/\s+/g, " ").trim();
  const explicit = value.match(/^순위\s*(\d{1,3})(?:\s*위|\.)?\s*(.*)$/i)
    || value.match(/^(\d{1,3})(?:\s*위|\.)\s*(.*)$/i);
  const plain = value.match(/^(\d{1,3})$/);
  const matched = explicit || plain;
  const rank = Number(matched?.[1] || 0);
  if (rank < 1 || rank > Math.max(1, Number(limit) || 200)) return null;
  return { rank, remainder: explicit ? String(explicit[2] || "").trim() : "" };
}

function normalizedSellerLines(text, limit) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap((line) => {
      const ranked = sellerRankFromLine(line, limit);
      if (!ranked?.remainder) return [line];
      return [`${ranked.rank}.`, ranked.remainder];
    });
}

export function isSellerArticleNumber(line) {
  const value = String(line || "").replace(/\s+/g, " ").trim();
  if (!value || ignored(value) || MEASUREMENT_PATTERN.test(value)) return false;
  if (/^(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?%)$/.test(value)) return false;
  if (ARTICLE_LINE_PATTERN.test(value)) return true;
  if (!COMPOUND_ARTICLE_PATTERN.test(value)) return false;
  const firstToken = value.split(" ")[0];
  return /\d/.test(firstToken) && /[-_/.]/.test(firstToken);
}

function articleScore(line) {
  const value = String(line || "").trim();
  if (!isSellerArticleNumber(value)) return -1;
  if (/\s/.test(value) && /[-_/.]/.test(value.split(" ")[0])) return 100;
  if (/(?=.*[A-Z])(?=.*\d)/i.test(value)) return 70;
  if (/^\d{6,}$/.test(value)) return 50;
  return 10;
}

function descriptiveName(lines, codeIndex, rankIndex, articleNumber) {
  const candidates = [
    ...lines.slice(codeIndex + 1, codeIndex + 5),
    ...lines.slice(Math.max(rankIndex + 1, codeIndex - 3), codeIndex).reverse(),
  ];
  return candidates.find((line) => (
    line !== articleNumber
    && !ignored(line)
    && !isSellerArticleNumber(line)
    && !MEASUREMENT_PATTERN.test(line)
    && !/^[\d,.%]+$/.test(line)
    && line.length >= 3
  )) || articleNumber;
}

export function parseSellerDomNodes(nodes, limit = 200) {
  const products = [];
  const seen = new Set();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const lines = normalizedSellerLines(node?.text, limit);
    // Some Seller Center rows include accessibility labels and option text.
    // Keep accepting a complete product row without discarding it merely
    // because the virtualized component exposes more than forty lines.
    if (lines.length < 2 || lines.length > 120) continue;
    const rankIndex = lines.findIndex((line) => Boolean(sellerRankFromLine(line, limit)));
    const structuredCodeIndex = rankIndex >= 0
      ? lines
        .map((line, index) => ({
          index,
          score: index > rankIndex && index <= rankIndex + 7 ? articleScore(line) : -1,
        }))
        .filter((candidate) => candidate.score >= 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.index ?? -1
      : -1;
    const codeIndex = structuredCodeIndex >= 0
      ? structuredCodeIndex
      : lines.findIndex((line) => ARTICLE_PATTERN.test(line));
    if (codeIndex < 0) continue;
    const rawArticleNumber = structuredCodeIndex >= 0
      ? lines[codeIndex]
      : lines[codeIndex].match(ARTICLE_PATTERN)?.[0] || "";
    const articleNumber = /\s/.test(rawArticleNumber) ? rawArticleNumber : rawArticleNumber.toUpperCase();
    if (!articleNumber) continue;
    const numericPrices = lines
      .filter((line) => !ARTICLE_PATTERN.test(line) && /(?:\d{1,3},)+\d{3}|\d{4,}/.test(line))
      .map(price)
      .filter((value) => value >= 1_000);
    const sameLineName = structuredCodeIndex >= 0
      ? ""
      : lines[codeIndex].replace(ARTICLE_PATTERN, "").trim();
    const name = (!ignored(sameLineName) && sameLineName)
      || descriptiveName(lines, codeIndex, rankIndex, articleNumber);
    const rankLine = lines.slice(0, codeIndex).find((line) => Boolean(sellerRankFromLine(line, limit)));
    if (!numericPrices.length && !rankLine) continue;
    const detectedRank = sellerRankFromLine(rankLine, limit)?.rank || 0;
    const rank = detectedRank || Math.min(products.length + 1, 999);
    const seenKey = `${rank}:${articleNumber}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    products.push({
      rank,
      rankDetected: detectedRank > 0,
      articleNumber,
      name,
      averagePrice: numericPrices[0] || 0,
      lowestPrice: numericPrices[1] || 0,
      highestPrice: numericPrices[2] || 0,
      sales30d: 0,
      source: "seller-center-dom",
      logoUrl: String(node?.imageUrl || ""),
      sellerCenterDirect: true,
      rawText: String(node?.text || ""),
    });
    if (products.length >= limit) break;
  }
  return products.sort((left, right) => left.rank - right.rank);
}

export function dedupeSellerProducts(products, limit = 200) {
  const unique = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    const key = String(product?.articleNumber || "").trim().toUpperCase();
    if (!key) continue;
    const previous = unique.get(key);
    if (!previous || Number(product.rank || 999) < Number(previous.rank || 999)) unique.set(key, product);
  }
  return [...unique.values()]
    .sort((left, right) => Number(left.rank || 999) - Number(right.rank || 999))
    .slice(0, limit)
    .map((product, index) => ({ ...product, articleNumber: String(product.articleNumber).toUpperCase(), rank: index + 1 }));
}

export function mergeSellerProductsByRank(productGroups, limit = 200) {
  const slots = new Map();
  const score = (product) => (
    (String(product?.articleNumber || "").trim() ? 8 : 0)
    + (String(product?.name || "").trim() ? 6 : 0)
    + (Number(product?.averagePrice || 0) > 0 ? 3 : 0)
    + (Number(product?.lowestPrice || 0) > 0 ? 1 : 0)
    + (Number(product?.highestPrice || 0) > 0 ? 1 : 0)
    + (String(product?.logoUrl || "").trim() ? 1 : 0)
    + (String(product?.rawText || "").trim() ? 1 : 0)
  );
  for (const group of Array.isArray(productGroups) ? productGroups : []) {
    for (const product of Array.isArray(group) ? group : []) {
      const rank = Number(product?.rank || 0);
      const articleNumber = String(product?.articleNumber || "").trim().toUpperCase();
      const name = String(product?.name || "").trim();
      if (rank < 1 || rank > limit || (!articleNumber && !name)) continue;
      const previous = slots.get(rank);
      if (!previous || score(product) > score(previous)) {
        slots.set(rank, { ...product, rank, articleNumber, name: name || articleNumber });
      } else {
        slots.set(rank, {
          ...product,
          ...previous,
          articleNumber: previous.articleNumber || articleNumber,
          name: previous.name || name || articleNumber,
          logoUrl: previous.logoUrl || product.logoUrl || "",
          rawText: previous.rawText || product.rawText || "",
        });
      }
    }
  }
  return [...slots.values()].sort((left, right) => left.rank - right.rank);
}
