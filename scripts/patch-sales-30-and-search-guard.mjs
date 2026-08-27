import { readFile, writeFile } from "node:fs/promises";

const salesPath = new URL("../services/poizon-sales-filter.mjs", import.meta.url);
const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);

let sales = String(await readFile(salesPath, "utf8")).replace(/\r\n/g, "\n");
let sourcing = String(await readFile(sourcingPath, "utf8")).replace(/\r\n/g, "\n");

sales = sales.replace(
  "export const POIZON_MINIMUM_TOTAL_SALES = 50;",
  "export const POIZON_MINIMUM_TOTAL_SALES = 30;",
);

sales = sales.replace(
  "if (totalSales < threshold && localTotalSales < threshold) continue;",
  "if (totalSales < threshold || localTotalSales < threshold) continue;",
);

sales = sales.replace(
  "    matchMode: \"any\",\n  };\n}",
  "    matchMode: \"all\",\n  };\n}",
);

const referenceFallback = "const referenceProduct = highestSizeByIdentity.get(sourcingProductIdentity(product)) || product;";
const referenceGuard = `const referenceProduct = highestSizeByIdentity.get(sourcingProductIdentity(product));\n            if (!referenceProduct || referenceProduct !== product) return \"\";`;
if (sourcing.includes(referenceFallback)) sourcing = sourcing.replace(referenceFallback, referenceGuard);

sourcing = sourcing.replace(
  "rows.innerHTML = products.length ? products.map((product, index) => {",
  "rows.innerHTML = highestSizeByIdentity.size ? products.map((product, index) => {",
);

const marker = "data-around-g-sales-30-search-guard";
if (!sourcing.includes(marker)) {
  sourcing = `${sourcing.trimEnd()}\n\n(() => {\n  const marker = \"${marker}\";\n  if (document.documentElement.hasAttribute(marker)) return;\n  document.documentElement.setAttribute(marker, \"true\");\n\n  const sizeSalesValue = (product = {}) => {\n    const raw = String(product?.sales30dRaw || product?.localSales30dRaw || \"\").normalize(\"NFKC\").trim();\n    const lessThan = raw.match(/^<\\s*([\\d,]+(?:\\.\\d+)?)/);\n    if (lessThan) {\n      const ceiling = Number(lessThan[1].replace(/,/g, \"\"));\n      return Number.isFinite(ceiling) ? Math.max(0, ceiling - 1) : 0;\n    }\n    const rawNumber = Number(raw.replace(/[^0-9.]/g, \"\"));\n    if (raw && Number.isFinite(rawNumber)) return rawNumber;\n    const chinaValue = Number(product?.sales30d);\n    const localValue = Number(product?.localSales30d);\n    if (Number.isFinite(chinaValue)) return chinaValue;\n    if (Number.isFinite(localValue)) return localValue;\n    return 0;\n  };\n\n  const eligible = (product) => sizeSalesValue(product) >= 30;\n\n  const pruneSelection = () => {\n    try {\n      if (typeof selectedExcelPreviewProducts !== \"undefined\" && typeof excelPreviewProductCache !== \"undefined\") {\n        for (const key of [...selectedExcelPreviewProducts]) {\n          const product = excelPreviewProductCache.get(key);\n          if (product && !eligible(product)) selectedExcelPreviewProducts.delete(key);\n        }\n      }\n\n      document.querySelectorAll(\"[data-excel-search-product]\").forEach((button) => {\n        const key = decodeURIComponent(String(button.dataset.excelSearchProduct || \"\"));\n        const product = typeof excelPreviewProductCache !== \"undefined\" ? excelPreviewProductCache.get(key) : null;\n        if (!product || eligible(product)) return;\n        button.disabled = true;\n        button.textContent = \"판매량 30 미만\";\n        const row = button.closest(\"tr\");\n        const checkbox = row?.querySelector(\"[data-excel-product-select]\");\n        if (checkbox) {\n          checkbox.checked = false;\n          checkbox.disabled = true;\n        }\n      });\n\n      if (typeof updateExcelPreviewSelectionUi === \"function\") {\n        const visibleKeys = [...document.querySelectorAll(\"[data-excel-product-select]:not(:disabled)\")]\n          .map((checkbox) => decodeURIComponent(String(checkbox.dataset.excelProductSelect || \"\")))\n          .filter(Boolean);\n        updateExcelPreviewSelectionUi(visibleKeys);\n      }\n    } catch (error) {\n      console.warn(\"[sales-30-guard] selection prune skipped\", error);\n    }\n  };\n\n  try {\n    if (typeof searchExcelPreviewProduct === \"function\" && !searchExcelPreviewProduct.__aroundGSales30Guard) {\n      const originalSearchExcelPreviewProduct = searchExcelPreviewProduct;\n      const guardedSearchExcelPreviewProduct = async function guardedSearchExcelPreviewProduct(key, options = {}) {\n        const product = typeof excelPreviewProductCache !== \"undefined\" ? excelPreviewProductCache.get(key) : null;\n        if (product && !eligible(product)) {\n          if (typeof selectedExcelPreviewProducts !== \"undefined\") selectedExcelPreviewProducts.delete(key);\n          if (typeof excelPreviewSearchResults !== \"undefined\") excelPreviewSearchResults.delete(key);\n          pruneSelection();\n          return { ok: false, code: \"SALES_BELOW_30\", message: \"사이즈 판매량 30건 미만은 국내 검색 대상에서 제외됩니다.\" };\n        }\n        return originalSearchExcelPreviewProduct.call(this, key, options);\n      };\n      guardedSearchExcelPreviewProduct.__aroundGSales30Guard = true;\n      searchExcelPreviewProduct = guardedSearchExcelPreviewProduct;\n    }\n  } catch (error) {\n    console.warn(\"[sales-30-guard] search wrapper skipped\", error);\n  }\n\n  document.addEventListener(\"click\", (event) => {\n    if (event.target?.closest?.(\"#excel-preview-search-selected\")) pruneSelection();\n  }, true);\n\n  document.addEventListener(\"change\", (event) => {\n    if (event.target?.matches?.(\"#excel-preview-select-page\")) queueMicrotask(pruneSelection);\n  });\n\n  const rows = document.querySelector(\"#excel-preview-rows\");\n  if (rows) {\n    const observer = new MutationObserver(() => queueMicrotask(pruneSelection));\n    observer.observe(rows, { childList: true, subtree: true });\n  }\n\n  pruneSelection();\n})();\n`;
}

await writeFile(salesPath, sales, "utf8");
await writeFile(sourcingPath, sourcing, "utf8");
console.log("sales threshold fixed: total-sales AND >=30 and size-sales domestic search guard enabled");
