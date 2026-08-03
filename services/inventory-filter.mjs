export const SALES_MODES = {
  recent30: {
    localKey: "localSales30d",
    chinaKey: "sales30d",
    localRawKey: "localSales30dRaw",
    chinaRawKey: "sales30dRaw",
    localAvailabilityKey: "hasLocalSalesData",
    chinaAvailabilityKey: "hasSalesData",
    localLabel: "현지 판매자 최근 30일 판매량",
    chinaLabel: "중국 최근 30일 판매량",
  },
  total: {
    localKey: "localTotalSales",
    chinaKey: "totalSales",
    localRawKey: "localTotalSalesRaw",
    chinaRawKey: "totalSalesRaw",
    localAvailabilityKey: "hasLocalTotalSalesData",
    chinaAvailabilityKey: "hasTotalSalesData",
    localLabel: "현지 판매자 총 판매량",
    chinaLabel: "중국 총 판매량",
  },
};

export function salesPair(row = {}, mode = "recent30") {
  const definition = SALES_MODES[mode] || SALES_MODES.recent30;
  return {
    local: Number(row[definition.localKey] || 0),
    china: Number(row[definition.chinaKey] || 0),
    localRaw: row[definition.localRawKey] ?? "",
    chinaRaw: row[definition.chinaRawKey] ?? "",
    localLabel: definition.localLabel,
    chinaLabel: definition.chinaLabel,
  };
}

export function hasSalesMode(products = [], mode = "recent30") {
  const definition = SALES_MODES[mode] || SALES_MODES.recent30;
  return products.some((product) => product?.[definition.localAvailabilityKey])
    && products.some((product) => product?.[definition.chinaAvailabilityKey]);
}

function within(value, minimum, maximum) {
  return (minimum === null || value >= minimum)
    && (maximum === null || value <= maximum);
}

export function filterInventoryProducts(products = [], input = {}) {
  const mode = SALES_MODES[input.mode] ? input.mode : "recent30";
  const localMinimum = input.localMinimum ?? 30;
  const chinaMinimum = input.chinaMinimum ?? 30;
  const localMaximum = input.localMaximum ?? null;
  const chinaMaximum = input.chinaMaximum ?? null;
  const metric = (row) => salesPair(row, mode);

  return products
    .map((product) => {
      const variants = Array.isArray(product.variants) && product.variants.length
        ? product.variants
        : [product];
      const filteredVariants = variants
        .filter((variant) => {
          const sales = metric(variant);
          return within(sales.local, localMinimum, localMaximum)
            && within(sales.china, chinaMinimum, chinaMaximum);
        })
        .sort((left, right) => {
          const a = metric(left);
          const b = metric(right);
          return b.local - a.local || b.china - a.china;
        });
      return { ...product, filteredVariants };
    })
    .filter((product) => product.filteredVariants.length > 0)
    .sort((left, right) => {
      const a = metric(left.filteredVariants[0] || left);
      const b = metric(right.filteredVariants[0] || right);
      return b.local - a.local || b.china - a.china;
    });
}
