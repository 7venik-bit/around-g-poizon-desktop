import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`domestic horizontal row verification failed: ${message}`); };

if (!sourcing.includes("data-around-g-domestic-horizontal-row")) fail("runtime marker missing");
if (!sourcing.includes('grid-template-columns", "44px minmax(0, 1fr) 104px"')) fail("horizontal product row columns missing");
if (!sourcing.includes('grid-column", "2"')) fail("product information column missing");
if (!sourcing.includes('grid-column", "3"')) fail("price/action column missing");
if (!sourcing.includes(".sourcing-product-list-row")) fail("domestic row selector missing");
if (!sourcing.includes(".sourcing-source-fallback")) fail("fallback row selector missing");
if (!sourcing.includes(".candidate-summary")) fail("legacy candidate horizontal fallback missing");
if (!sourcing.includes("MutationObserver")) fail("dynamic-result observer missing");

console.log("domestic detail horizontal row layout verified: image | data | price/action");
