import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`compact sourcing list UI verification failed: ${message}`); };

if (!sourcing.includes("data-compact-sourcing-list-style")) fail("style marker missing");
if (!sourcing.includes("grid-template-columns:58px minmax(0,1fr) 118px")) fail("compact product row grid missing");
if (!sourcing.includes("width:56px!important;height:56px!important")) fail("56px domestic thumbnail limit missing");
if (!sourcing.includes(".excel-product-search-detail img")) fail("search-detail image clamp missing");
if (!sourcing.includes("min-height:42px!important")) fail("compact link-only row height missing");
if (!sourcing.includes("background:#ecfdf3!important")) fail("product-present status chip missing");
if (!sourcing.includes("background:#fff!important;border-left:3px solid #e5e7eb")) fail("neutral detail-row style missing");

console.log("compact sourcing list UI verified: images clamped and results rendered as dense rows");
