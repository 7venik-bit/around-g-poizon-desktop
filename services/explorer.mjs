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

export function parsePopularTable(input) {
  const lines = String(input || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("POPULAR_TABLE_ROWS_REQUIRED");
  const delimiter = delimiterFor(lines[0]);
  const headers = splitLine(lines[0], delimiter).map(clean);
  const rankIndex = headerIndex(headers, ["No", "순위", "번호"]);
  const nameIndex = headerIndex(headers, ["상품정보", "상품명", "상품"]);
  const articleIndex = headerIndex(headers, ["상품번호", "품번", "Article"]);
  const priceIndex = headerIndex(headers, ["평균 거래가", "평균거래가", "거래가", "가격"]);
  const salesIndex = headerIndex(headers, ["최근 30일", "30일 판매", "판매량", "거래량"]);
  if (nameIndex < 0) throw new Error("POPULAR_TABLE_HEADER_NOT_FOUND");

  return lines.slice(1).flatMap((line, rowIndex) => {
    const cells = splitLine(line, delimiter).map(clean);
    const name = cells[nameIndex] || "";
    if (!name) return [];
    const articleMatch = name.match(/\b[A-Z0-9][A-Z0-9._/-]{3,}\b/i);
    return [{
      rank: numberFrom(cells[rankIndex]) || rowIndex + 1,
      name,
      articleNumber: cells[articleIndex] || articleMatch?.[0] || "",
      averagePrice: numberFrom(cells[priceIndex]),
      sales30d: numberFrom(cells[salesIndex]),
      source: "seller-center-paste",
    }];
  });
}

export function categoryGroup(product) {
  const text = clean([
    product.level1CategoryName,
    product.level2CategoryName,
    product.categoryName,
    product.title,
  ].join(" ")).toLowerCase();
  if (/아우터|재킷|자켓|점퍼|코트|패딩|다운/.test(text)) return "아우터";
  if (/신발|슈즈|운동화|구두|샌들|슬리퍼|부츠|스니커/.test(text)) return "신발";
  if (/가방|백팩|크로스백|토트백|파우치/.test(text)) return "가방";
  if (/모자|캡|비니|햇/.test(text)) return "모자";
  if (/액세서리|주얼리|시계|벨트|양말|안경|스카프/.test(text)) return "액세서리";
  if (/의류|상의|하의|티셔츠|셔츠|팬츠|바지|스커트|드레스|속옷/.test(text)) return "의류";
  return "기타";
}

export function normalizeBrandResult(data, salesByArticle = {}) {
  const rows = Array.isArray(data) ? data : data?.contents || data?.list || [];
  return rows.map((row) => {
    const articleNumber = clean(row.articleNumber);
    const apiSales = row.sales30d ?? row.recent30DaySales ?? row.soldCount30d;
    const sales30d = numberFrom(apiSales ?? salesByArticle[articleNumber]);
    return {
      ...row,
      articleNumber,
      sales30d,
      hasSalesData: apiSales !== undefined || salesByArticle[articleNumber] !== undefined,
      categoryGroup: categoryGroup(row),
    };
  });
}
