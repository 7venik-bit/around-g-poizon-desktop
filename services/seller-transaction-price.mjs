function numberFrom(value) {
  const number = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

export function recentThirtyDaySales(value) {
  const text = String(value ?? "").trim();
  if (/^<\s*5$/i.test(text)) return 4;
  return numberFrom(text);
}

export function transactionPrices(rows = []) {
  const prices = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const cells = Array.isArray(row?.cells) ? row.cells : [];
    const text = String(row?.text || cells.join(" "));
    if (!/[₩￦원]/.test(text)) continue;
    const preferred = cells.find((cell) => /[₩￦원]/.test(String(cell || ""))) || text;
    const price = numberFrom(preferred);
    if (price >= 1_000 && price <= 100_000_000) prices.push(price);
  }
  return prices;
}

export function qualifiedOptionPrices(rows = [], minimumSales = 30) {
  const options = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const text = String(row?.text || "").trim();
    const option = String(row?.option || "").trim();
    if (/^ALL$/i.test(option) || /^ALL\b/i.test(text)) continue;
    const price = numberFrom(row?.price);
    const sales = recentThirtyDaySales(row?.sales);
    if (price >= 1_000 && price <= 100_000_000 && sales >= minimumSales) {
      options.push({ option, price, sales });
    }
  }
  return options;
}

export function highestQualifiedOptionPrice({ rows, minimumSales = 30 } = {}) {
  const options = qualifiedOptionPrices(rows, minimumSales);
  const highest = options.reduce((best, option) => option.price > (best?.price || 0) ? option : best, null);
  return {
    eligible: Boolean(highest),
    price: highest?.price || 0,
    option: highest?.option || "",
    optionSales: highest?.sales || 0,
    qualifiedOptionCount: options.length,
    options,
  };
}

const normalizedKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9가-힣一-龥]/g, "");
const priceKey = (key) => /price|amount|가격|금액|售价|价格|價/.test(normalizedKey(key));
const salesKey = (key) => /sales|sold|sale.*(?:qty|count|num|volume)|trade.*(?:qty|count|num|volume)|deal.*(?:qty|count|num|volume)|volume|판매량|销量|銷量|成交量/.test(normalizedKey(key));
const optionKey = (key) => /size|option|spec|sku.*name|sizename|사이즈|옵션|尺码|規格/.test(normalizedKey(key));

function plausibleValues(record, predicate, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  return Object.entries(record || {}).filter(([key]) => predicate(key)).map(([, value]) => numberFrom(value))
    .filter((value) => value >= minimum && value <= maximum);
}

export function optionRowsFromSellerResponses(responses = []) {
  const rows = [];
  const seen = new Set();
  const descendantValues = (value, predicate, depth = 0, values = []) => {
    if (depth > 8 || value == null || typeof value !== "object") return values;
    if (!Array.isArray(value)) {
      values.push(...plausibleValues(value, predicate, {
        minimum: predicate === priceKey ? 1_000 : 0,
        maximum: 100_000_000,
      }));
    }
    Object.values(value).forEach((item) => descendantValues(item, predicate, depth + 1, values));
    return values;
  };
  const visit = (value, depth = 0, context = {}) => {
    if (depth > 16 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1, context));
      return;
    }
    if (typeof value !== "object") return;

    // POIZON response shapes vary: option, sales and price can live on a
    // parent object and its nested quote/statistic objects. Carry the nearest
    // values down instead of requiring all three fields on the same object.
    const optionEntry = Object.entries(value)
      .find(([key, item]) => optionKey(key) && ["string", "number"].includes(typeof item));
    const localPrices = plausibleValues(value, priceKey, { minimum: 1_000, maximum: 100_000_000 });
    const localSales = plausibleValues(value, salesKey, { minimum: 0, maximum: 100_000_000 });
    const option = String(optionEntry?.[1] ?? context.option ?? "").trim();
    // When an option is present, price/statistics are commonly stored in
    // separate sibling objects below that SKU. Collect the whole option
    // subtree before falling back to inherited values.
    const subtreePrices = optionEntry ? descendantValues(value, priceKey) : [];
    const subtreeSales = optionEntry ? descendantValues(value, salesKey) : [];
    const nextContext = {
      option,
      prices: subtreePrices.length ? subtreePrices
        : localPrices.length ? localPrices : (context.prices || []),
      sales: subtreeSales.length ? subtreeSales
        : localSales.length ? localSales : (context.sales || []),
    };

    if (nextContext.option && nextContext.prices.length && nextContext.sales.length) {
      const price = Math.max(...nextContext.prices);
      const sales = Math.max(...nextContext.sales);
      const id = `${nextContext.option}|${price}|${sales}`;
      if (!seen.has(id)) {
        seen.add(id);
        rows.push({
          option: nextContext.option,
          price,
          sales,
          text: `${nextContext.option} ${price} ${sales}`,
        });
      }
    }
    Object.values(value).forEach((item) => visit(item, depth + 1, nextContext));
  };
  for (const response of Array.isArray(responses) ? responses : []) {
    let payload = response?.body ?? response;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch { continue; }
    }
    visit(payload);
  }
  return rows;
}

export function highestQualifiedTransactionPrice({ sales30d, rows, minimumSales = 30 } = {}) {
  const sales = recentThirtyDaySales(sales30d);
  if (sales < minimumSales) {
    return { eligible: false, sales30d: sales, price: 0, transactionCount: 0 };
  }
  const prices = transactionPrices(rows);
  return {
    eligible: true,
    sales30d: sales,
    price: prices.length ? Math.max(...prices) : 0,
    transactionCount: prices.length,
  };
}
