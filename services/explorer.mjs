export const BRAND_CATALOG = [
  { id: 144, name: "Nike", ko: "나이키" },
  { id: 3, name: "Adidas", ko: "아디다스" },
  { id: 4, name: "New Balance", ko: "뉴발란스" },
  { id: 2, name: "Puma", ko: "푸마" },
  { id: 7, name: "Under Armour", ko: "언더아머" },
  { id: 8, name: "ASICS", ko: "아식스" },
  { id: 9, name: "Vans", ko: "반스" },
];

export const CATEGORY_GROUPS = ["전체", "신발", "의류", "아우터", "가방", "모자", "액세서리", "기타"];

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numberFrom(value) {
  const number = Number(clean(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function delimiterFor(line) {
  if (line.includes("\t")) return "\t";
  if (line.includes(",")) return ",";
  return null;
}

function splitLine(line, delimiter) {
  if (!delimiter) return line.trim().split(/\s{2,}/);
  if (delimiter === "\t") return line.split("\t");
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(current);
      current = "";
    } else current += character;
  }
  cells.push(current);
  return cells;
}

function headerIndex(headers, candidates) {
  return headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));
}

function parseVerticalPopularTable(input) {
  const lines = String(input || "").split(/\r?\n/).map(clean).filter(Boolean);
  const firstRank = lines.findIndex((line) => /^\d+[.)]?$/.test(line));
  if (firstRank < 0 || !lines.slice(0, firstRank).some((line) => line.includes("상품정보"))) return null;
  const rankIndexes = lines.flatMap((line, index) => /^\d+[.)]?$/.test(line) ? [index] : []);
  const products = [];
  for (let rankPosition = 0; rankPosition < rankIndexes.length; rankPosition += 1) {
    const start = rankIndexes[rankPosition];
    const end = rankIndexes[rankPosition + 1] ?? lines.length;
    const cells = lines.slice(start + 1, end);
    const articleIndex = cells.findIndex((value) => /^(?=[A-Z0-9._/-]*\d)[A-Z0-9][A-Z0-9._/-]{3,}$/i.test(value));
    if (articleIndex < 0) continue;
    const articleNumber = cells[articleIndex];
    const name = cells.slice(articleIndex + 1).find((value) =>
      value !== "주간 대비" && !/%$/.test(value) && !/^[\d,.]+(?:원)?$/.test(value)
    ) || articleNumber;
    const prices = cells.slice(articleIndex + 1)
      .filter((value) => !/%$/.test(value) && /^[\d,]+(?:원)?$/.test(value))
      .map(numberFrom)
      .filter((value) => value > 0);
    products.push({
      rank: numberFrom(lines[start]) || rankPosition + 1,
      name,
      articleNumber,
      averagePrice: prices[0] || 0,
      sales30d: 0,
      source: "seller-center-paste",
    });
  }
  return products;
}

export function parsePopularTable(input) {
  const verticalProducts = parseVerticalPopularTable(input);
  if (verticalProducts?.length) return verticalProducts;
  const physicalLines = String(input || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (physicalLines.length < 2) throw new Error("POPULAR_TABLE_ROWS_REQUIRED");
  const lines = [physicalLines[0]];
  for (const line of physicalLines.slice(1)) {
    if (/^\d+[.)]?\s*\t/.test(line) || lines.length === 1) lines.push(line);
    else lines[lines.length - 1] += ` ${line}`;
  }
  const delimiter = delimiterFor(lines[0]);
  const headers = splitLine(lines[0], delimiter).map(clean);
  const rankIndex = headerIndex(headers, ["No", "순위", "번호"]);
  const nameIndex = headerIndex(headers, ["상품정보", "상품명", "상품", "Product"]);
  const articleIndex = headerIndex(headers, ["상품번호", "품번", "Article"]);
  const priceIndex = headerIndex(headers, ["평균 거래가", "평균거래가", "거래가", "가격", "Average Price"]);
  const salesIndex = headerIndex(headers, ["최근 30일", "30일 판매", "판매량", "거래량"]);
  if (nameIndex < 0) throw new Error("POPULAR_TABLE_HEADER_NOT_FOUND");

  const products = lines.slice(1).flatMap((line, rowIndex) => {
    const cells = splitLine(line, delimiter).map(clean);
    const productInfo = cells[nameIndex] || "";
    if (!productInfo) return [];
    const articleMatch = productInfo.match(/\b(?=[A-Z0-9._/-]*\d)[A-Z0-9][A-Z0-9._/-]{3,}\b/i);
    const articleNumber = cells[articleIndex] || articleMatch?.[0] || "";
    const name = clean(productInfo.replace(articleNumber, "")) || productInfo;
    return [{
      rank: numberFrom(cells[rankIndex]) || rowIndex + 1,
      name,
      articleNumber,
      averagePrice: numberFrom(cells[priceIndex]),
      sales30d: numberFrom(cells[salesIndex]),
      source: "seller-center-paste",
    }];
  });
  if (!products.length) throw new Error("POPULAR_TABLE_ROWS_REQUIRED");
  return products;
}

export function categoryGroup(product) {
  const text = clean([
    product.level1CategoryName,
    product.level2CategoryName,
    product.level3CategoryName,
    product.categoryName,
    product.category,
    product.productName,
    product.productNameEn,
    product.englishProductName,
    product.name,
    product.title,
  ].join(" ")).toLowerCase();
  if (/아우터|재킷|자켓|점퍼|코트|패딩|다운|\b(?:outerwear|jacket|coat|parka|puffer|windbreaker)\b/.test(text)) return "아우터";
  if (/신발|슈즈|운동화|구두|샌들|슬리퍼|부츠|스니커|\b(?:footwear|shoes?|sneakers?|trainers?|boots?|sandals?|slippers?|clogs?|mules?|loafers?)\b/.test(text)) return "신발";
  if (/가방|백팩|크로스백|토트백|파우치|\b(?:bags?|backpacks?|crossbody|totes?|pouches?|luggage|duffels?)\b/.test(text)) return "가방";
  if (/모자|캡|비니|햇|\b(?:headwear|hats?|caps?|beanies?|bucket hats?)\b/.test(text)) return "모자";
  if (/액세서리|주얼리|시계|벨트|양말|안경|스카프|\b(?:accessories|jewelry|watches?|belts?|socks?|eyewear|glasses|scarves?|wallets?|gloves?)\b/.test(text)) return "액세서리";
  if (/의류|상의|하의|티셔츠|셔츠|팬츠|바지|스커트|드레스|속옷|\b(?:apparel|clothing|shirts?|tees?|t-shirts?|pants?|trousers?|shorts?|skirts?|dresses?|underwear|hoodies?|sweatshirts?|jerseys?)\b/.test(text)) return "의류";
  return "기타";
}

export function normalizeBrandResult(data, salesByArticle = {}) {
  const rows = Array.isArray(data) ? data : data?.contents || data?.list || [];
  return rows.map((row) => {
    const articleNumber = clean(row.articleNumber);
    const englishTitle = clean(
      row.productNameEn
      ?? row.englishProductName
      ?? row.titleEn
      ?? row.nameEn
      ?? row.englishName
      ?? row.productName
      ?? row.title
      ?? row.name,
    );
    const apiSales = row.sales30d ?? row.recent30DaySales ?? row.soldCount30d;
    const apiLocalSales = row.localSales30d
      ?? row.localSellerSales30d
      ?? row.localSellerRecent30DaySales
      ?? row.localSellerSoldCount30d
      ?? row.localRecent30DaySales
      ?? row.sellerSales30d
      ?? row.merchantSales30d
      ?? row.localSellerSaleQuantity30Days;
    const normalizedArticle = articleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const fallbackSales = salesByArticle[articleNumber]
      ?? salesByArticle[articleNumber.toUpperCase()]
      ?? salesByArticle[normalizedArticle];
    const fallbackSales30d = fallbackSales && typeof fallbackSales === "object"
      ? fallbackSales.sales30d : fallbackSales;
    const fallbackLocalSales30d = fallbackSales && typeof fallbackSales === "object"
      ? fallbackSales.localSales30d : undefined;
    const sales30d = numberFrom(apiSales ?? fallbackSales30d);
    const localSales30d = numberFrom(apiLocalSales ?? fallbackLocalSales30d);
    return {
      ...row,
      articleNumber,
      title: englishTitle,
      name: englishTitle,
      apiTitle: englishTitle,
      sales30d,
      localSales30d,
      hasSalesData: apiSales !== undefined || fallbackSales30d !== undefined,
      hasLocalSalesData: apiLocalSales !== undefined || fallbackLocalSales30d !== undefined,
      categoryGroup: categoryGroup(row),
    };
  });
}
