import { readFile } from "node:fs/promises";

const sales = String(await readFile(new URL("../services/poizon-sales-filter.mjs", import.meta.url), "utf8"));
const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`sales 30 AND guard verification failed: ${message}`); };

if (!sales.includes("POIZON_MINIMUM_TOTAL_SALES = 30")) fail("default total-sales threshold is not 30");
if (!sales.includes("if (totalSales < threshold || localTotalSales < threshold) continue;")) fail("AND exclusion logic missing");
if (sales.includes("if (totalSales < threshold && localTotalSales < threshold) continue;")) fail("legacy OR-acceptance logic remains");
if (!sales.includes('matchMode: "all"')) fail("processed workbook still reports non-AND mode");

if (!sourcing.includes("data-around-g-sales-30-search-guard")) fail("runtime domestic-search guard missing");
if (!sourcing.includes("SALES_BELOW_30")) fail("low-sales search block code missing");
if (!sourcing.includes("referenceProduct !== product")) fail("only the qualified reference size is not enforced");
if (!sourcing.includes("highestSizeByIdentity.size ? products.map")) fail("empty qualified-size list handling missing");
if (!sourcing.includes("판매량 30 미만")) fail("low-sales row state missing");

console.log("sales 30 AND guard verified: both totals >=30 and size-sales searches >=30 only");
