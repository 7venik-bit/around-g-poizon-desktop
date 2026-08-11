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
