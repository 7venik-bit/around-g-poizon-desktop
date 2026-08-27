import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`compact sourcing table-list verification failed: ${message}`); };

if (!sourcing.includes("data-compact-sourcing-list-style")) fail("style marker missing");
if (!sourcing.includes("#explorer-product-grid .explorer-product-row")) fail("explorer row layout missing");
if (!sourcing.includes("#explorer-product-grid .product-summary img")) fail("explorer image clamp missing");
if (!sourcing.includes("#explorer-product-grid .seller-product-info img")) fail("seller result image clamp missing");
if (!sourcing.includes("width:44px!important;height:44px!important;max-width:44px!important")) fail("44px product thumbnail clamp missing");
if (!sourcing.includes(".sourcing-product-list-row{display:grid!important")) fail("domestic product row missing");
if (!sourcing.includes("min-height:56px!important")) fail("compact product row height missing");
if (!sourcing.includes(".sourcing-source-fallback{display:grid!important")) fail("link-only table row missing");
if (!sourcing.includes("min-height:36px!important")) fail("compact link-only row height missing");
if (!sourcing.includes("#excel-preview-grid img{width:44px!important;height:44px!important")) fail("Excel image clamp missing");
if (!sourcing.includes("background:#ecfdf3!important")) fail("product-present status chip missing");

console.log("compact sourcing table-list verified across explorer, seller, domestic, and Excel renderers");
