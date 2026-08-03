function countFrom(value) {
  const text = String(value ?? "").trim();
  if (/^<\s*5$/i.test(text)) return 4;
  const number = Number(text.replace(/[^\d]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function rawFrom(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function metricAvailable(value) {
  const raw = rawFrom(value);
  return raw !== "" && !/^(?:--+|-|N\/?A|null|undefined)$/i.test(raw);
}

function firstOwn(value, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value || {}, key) && value[key] !== null && value[key] !== "") {
      return value[key];
    }
  }
  return undefined;
}

function firstDeepOwn(value, keys, depth = 0, visited = new Set()) {
  if (!value || typeof value !== "object" || depth > 3 || visited.has(value)) return undefined;
  visited.add(value);
  const direct = firstOwn(value, keys);
  if (direct !== undefined) return direct;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = firstDeepOwn(child, keys, depth + 1, visited);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function extractSellerBrandApiProducts(document) {
  const products = [];
  const visited = new Set();
  const walk = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 14 || visited.has(value)) return;
    visited.add(value);
    if (!Array.isArray(value)) {
      const articleNumber = String(firstDeepOwn(value, [
        "articleNumber", "articleNo", "articleCode", "styleNo", "spuCode",
        "productCode", "productNo", "goodsCode", "goodsNo", "goodsSn",
        "articleNum", "productNumber", "skuArticleNumber",
      ]) || "").trim();
      const spuId = String(firstDeepOwn(value, [
        "spuId", "spuID", "globalSpuId", "globalSpuID", "spuNo", "spuCode",
      ]) || "").trim();
      const name = String(firstDeepOwn(value, [
        "productName", "goodsName", "spuName", "spuTitle", "productTitle", "title",
        "articleName", "productDesc",
      ]) || "").trim();
      if ((articleNumber || spuId) && name) {
        const average = firstDeepOwn(value, [
          "averagePrice", "avgPrice", "averageDealPrice", "recent30DayAveragePrice",
          "transactionPrice", "dealPrice", "avgTradePrice", "thirtyDayAveragePrice",
        ]);
        const exposure = firstDeepOwn(value, [
          "buyerExposure", "buyerPageExposure", "buyerPageView", "buyerPageViews",
          "chinaBuyerExposure", "buyerExposureCount", "buyerPageShowCount",
        ]);
        const sales = firstDeepOwn(value, [
          "sales30d", "recent30DaySales", "soldCount30d", "saleQuantity30Days",
          "recent30DaysSaleQuantity", "thirtyDaySales", "recentThirtyDaysSales",
          "recent30DaysSales", "recent30DaySaleCount", "thirtyDaySaleCount",
          "recent30DaysSalesVolume",
        ]);
        const localSales = firstDeepOwn(value, [
          "localSales30d", "localSellerSales30d", "localSellerRecent30DaySales",
          "localSellerSoldCount30d", "merchantSales30d", "sellerSales30d",
          "localSellerSaleQuantity30Days", "merchantRecent30DaysSales",
          "merchantRecent30DaySales", "localRecent30DaysSales",
          "merchantRecent30DaysSalesVolume",
        ]);
        const totalSales = firstDeepOwn(value, [
          "totalSales", "totalSoldCount", "cumulativeSales", "cumulativeSoldCount",
          "saleQuantityTotal", "totalSaleQuantity", "allTimeSales", "chinaTotalSales",
        ]);
        const localTotalSales = firstDeepOwn(value, [
          "localTotalSales", "localSellerTotalSales", "localSellerTotalSoldCount",
          "merchantTotalSales", "sellerTotalSales", "localSellerSaleQuantityTotal",
        ]);
        products.push({
          articleNumber,
          spuId,
          name,
          brandName: String(firstDeepOwn(value, ["brandName", "brandCnName", "brandEnName"]) || ""),
          categoryName: String(firstDeepOwn(value, ["categoryName", "categoryPath", "category"]) || ""),
          logoUrl: String(firstDeepOwn(value, ["imageUrl", "logoUrl", "cover", "picUrl", "imgUrl"]) || ""),
          averagePrice: countFrom(average),
          buyerExposure: countFrom(exposure),
          sales30d: countFrom(sales),
          localSales30d: countFrom(localSales),
          totalSales: countFrom(totalSales),
          localTotalSales: countFrom(localTotalSales),
          sales30dRaw: rawFrom(sales),
          localSales30dRaw: rawFrom(localSales),
          totalSalesRaw: rawFrom(totalSales),
          localTotalSalesRaw: rawFrom(localTotalSales),
          hasPriceData: metricAvailable(average),
          hasBuyerExposureData: metricAvailable(exposure),
          hasSalesData: metricAvailable(sales),
          hasLocalSalesData: metricAvailable(localSales),
          hasTotalSalesData: metricAvailable(totalSales),
          hasLocalTotalSalesData: metricAvailable(localTotalSales),
          source: "seller-center-network",
        });
      }
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, depth + 1);
  };
  walk(document);
  return mergeSellerBrandProducts(products);
}

export function mergeSellerBrandProducts(...collections) {
  const byKey = new Map();
  for (const row of collections.flat()) {
    if (!row) continue;
    const article = String(row.articleNumber || "").trim().toUpperCase();
    const spuId = String(row.spuId || "").trim();
    const key = article ? `ARTICLE:${article}` : spuId ? `SPU:${spuId}` : "";
    if (!key) continue;
    const previous = byKey.get(key) || {};
    const metric = (field, flag) => row[flag] ? row[field] : previous[field];
    const rawMetric = (field, flag) => row[flag] ? row[field] : previous[field];
    byKey.set(key, {
      ...previous,
      ...row,
      averagePrice: Number(row.averagePrice || previous.averagePrice || 0),
      buyerExposure: Number(row.buyerExposure || previous.buyerExposure || 0),
      sales30d: Number(metric("sales30d", "hasSalesData") ?? 0),
      localSales30d: Number(metric("localSales30d", "hasLocalSalesData") ?? 0),
      totalSales: Number(metric("totalSales", "hasTotalSalesData") ?? 0),
      localTotalSales: Number(metric("localTotalSales", "hasLocalTotalSalesData") ?? 0),
      sales30dRaw: rawMetric("sales30dRaw", "hasSalesData") ?? "",
      localSales30dRaw: rawMetric("localSales30dRaw", "hasLocalSalesData") ?? "",
      totalSalesRaw: rawMetric("totalSalesRaw", "hasTotalSalesData") ?? "",
      localTotalSalesRaw: rawMetric("localTotalSalesRaw", "hasLocalTotalSalesData") ?? "",
      hasPriceData: Boolean(previous.hasPriceData || row.hasPriceData),
      hasBuyerExposureData: Boolean(previous.hasBuyerExposureData || row.hasBuyerExposureData),
      hasSalesData: Boolean(previous.hasSalesData || row.hasSalesData),
      hasLocalSalesData: Boolean(previous.hasLocalSalesData || row.hasLocalSalesData),
      hasTotalSalesData: Boolean(previous.hasTotalSalesData || row.hasTotalSalesData),
      hasLocalTotalSalesData: Boolean(previous.hasLocalTotalSalesData || row.hasLocalTotalSalesData),
    });
  }
  return [...byKey.values()];
}

function productInfoIndex(cells) {
  return cells.findIndex((cell) => /(?:\uC0C1\uD488\s*\uBC88\uD638|SPU[\s_]*ID)/i.test(String(cell || "")));
}

export function parseSellerBrandRows(rows = []) {
  return rows.map((row) => {
    const cells = Array.isArray(row.cells) ? row.cells : [];
    const headers = Array.isArray(row.headers) ? row.headers : [];
    const headerIndex = (...patterns) => headers.findIndex((header) =>
      patterns.some((pattern) => pattern.test(String(header || "").replace(/\s+/g, " ").trim()))
    );
    const infoIndex = productInfoIndex(cells);
    const resolvedInfoIndex = infoIndex >= 0 ? infoIndex : 2;
    const info = String(cells[resolvedInfoIndex] || row.text || "");
    const lines = info.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const articleNumber = String(
      info.match(/\uC0C1\uD488\s*\uBC88\uD638\s*[:\uFF1A]?\s*([^\r\n]+)/i)?.[1]
      || lines.find((value) => /^(?=.*[A-Z])(?=.*\d)[A-Z0-9._/() -]{4,80}$/i.test(value))
      || ""
    ).trim();
    const spuId = String(
      info.match(/SPU[\s_]*ID\s*[:\uFF1A]?\s*(\d+)/i)?.[1] || ""
    ).trim();
    const name = String(
      info
        .replace(/.*\uC0C1\uD488\s*\uBC88\uD638\s*[:\uFF1A]?\s*[^\r\n]+\r?\n?/i, "")
        .replace(/SPU[\s_]*ID\s*[:\uFF1A]?.*$/is, "")
    ).trim();
    const averagePriceIndex = headerIndex(/최근\s*30일\s*평균\s*거래가/, /평균\s*거래가/);
    const buyerExposureIndex = headerIndex(/중국\s*구매자\s*페이지\s*노출/, /구매자.*노출/);
    const sales30dIndex = headerIndex(/^최근\s*30일\s*판매량$/, /최근\s*30일\s*판매량(?!.*현지)/);
    const localSales30dIndex = headerIndex(/현지\s*판매자\s*최근\s*30일\s*판매량/, /현지\s*판매자.*30일/);
    const totalSalesIndex = headerIndex(/^(?:중국\s*)?총\s*판매량$/, /누적\s*판매량/);
    const localTotalSalesIndex = headerIndex(/현지\s*판매자\s*총\s*판매량/, /현지\s*판매자.*누적/);
    const metricCell = (headerResolvedIndex, legacyOffset) =>
      cells[headerResolvedIndex >= 0 ? headerResolvedIndex : resolvedInfoIndex + legacyOffset];
    const averagePriceValue = metricCell(averagePriceIndex, 3);
    const buyerExposureValue = metricCell(buyerExposureIndex, 4);
    const sales30dValue = metricCell(sales30dIndex, 5);
    const localSales30dValue = metricCell(localSales30dIndex, 6);
    const totalSalesValue = totalSalesIndex >= 0 ? cells[totalSalesIndex] : undefined;
    const localTotalSalesValue = localTotalSalesIndex >= 0 ? cells[localTotalSalesIndex] : undefined;
    return {
      articleNumber,
      spuId,
      name,
      brandName: String(cells[resolvedInfoIndex + 1] || "").split(/\r?\n/)[0].trim(),
      categoryName: String(cells[resolvedInfoIndex + 1] || "").split(/\r?\n/).slice(1).join("/").trim(),
      logoUrl: String(row.imageUrl || ""),
      averagePrice: countFrom(averagePriceValue),
      buyerExposure: countFrom(buyerExposureValue),
      sales30d: countFrom(sales30dValue),
      localSales30d: countFrom(localSales30dValue),
      totalSales: countFrom(totalSalesValue),
      localTotalSales: countFrom(localTotalSalesValue),
      sales30dRaw: rawFrom(sales30dValue),
      localSales30dRaw: rawFrom(localSales30dValue),
      totalSalesRaw: rawFrom(totalSalesValue),
      localTotalSalesRaw: rawFrom(localTotalSalesValue),
      hasPriceData: metricAvailable(averagePriceValue),
      hasBuyerExposureData: metricAvailable(buyerExposureValue),
      hasSalesData: metricAvailable(sales30dValue),
      hasLocalSalesData: metricAvailable(localSales30dValue),
      hasTotalSalesData: totalSalesIndex >= 0 && metricAvailable(totalSalesValue),
      hasLocalTotalSalesData: localTotalSalesIndex >= 0 && metricAvailable(localTotalSalesValue),
    };
  }).filter((row) => row.articleNumber || row.spuId || row.name);
}

function productKey(row) {
  const article = String(row.articleNumber || "").trim().toUpperCase();
  if (article) return `ARTICLE:${article}`;
  const spuId = String(row.spuId || "").trim();
  return spuId ? `SPU:${spuId}` : "";
}

export function mergeSellerBrandPages(pages = []) {
  return mergeSellerBrandProducts(...pages.map((page) => parseSellerBrandRows(page)));
}

export function sellerBrandDiagnostics(pages = []) {
  const parsed = pages.flatMap((page) => parseSellerBrandRows(page));
  const unique = mergeSellerBrandPages(pages);
  return {
    rawRowCount: pages.reduce((sum, page) => sum + page.length, 0),
    parsedRowCount: parsed.length,
    uniqueRowCount: unique.length,
    articleMissingCount: parsed.filter((row) => !row.articleNumber).length,
    spuFallbackCount: parsed.filter((row) => !row.articleNumber && row.spuId).length,
    duplicateCount: Math.max(0, parsed.length - unique.length),
  };
}
