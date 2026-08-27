import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`Excel bulk import verification failed: ${message}`); };

if (!main.includes("const importItemsByIdentity = new Map()")) fail("product dedupe map missing");
if (!main.includes('await store.bulkUpsert("products", importItems.slice(start, start + 500))')) fail("500-item bulk save missing");
if (main.includes('await store.upsert("products", {\n        articleNumber,\n        name,\n        brand,')) fail("row-by-row save loop still present");
if (!main.includes("for (let start = 0; start < importItems.length; start += 500)")) fail("bulk batching loop missing");
if (!main.includes("const imported = importItems.length")) fail("imported count not based on deduplicated items");
if (!renderer.includes("Excel 불러오는 중…")) fail("visible import progress label missing");
if (!renderer.includes("button.textContent = previousLabel")) fail("import button label restore missing");

console.log("Excel bulk import verified: dedupe + 500-item bulk save + visible progress state");
