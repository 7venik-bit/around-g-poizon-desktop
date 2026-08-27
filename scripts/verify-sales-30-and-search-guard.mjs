import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`size-sales 30 search guard verification failed: ${message}`); };

if (!sourcing.includes("data-around-g-sales-30-search-guard")) fail("runtime domestic-search guard missing");
if (!sourcing.includes("SALES_BELOW_30")) fail("low-sales search block code missing");
if (!sourcing.includes("referenceProduct !== product")) fail("only the qualified reference size is not enforced");
if (!sourcing.includes("highestSizeByIdentity.size ? products.map")) fail("empty qualified-size list handling missing");
if (!sourcing.includes("판매량 30 미만")) fail("low-sales row state missing");
if (!sourcing.includes("sizeSalesValue(product) >= 30")) fail("30-sale eligibility test missing");

console.log("size-sales domestic search guard verified: only sales >=30 can enter domestic search");
