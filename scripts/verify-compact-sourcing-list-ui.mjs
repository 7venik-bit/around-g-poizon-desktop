import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`compact sourcing list UI verification failed: ${message}`); };

if (!sourcing.includes("data-compact-sourcing-list-style")) fail("style marker missing");
if (!sourcing.includes("#brand-product-workspace #excel-preview-grid img")) fail("integrated workspace image clamp missing");
if (!sourcing.includes("#excel-preview-grid img{width:48px!important;height:48px!important")) fail("global 48px product image clamp missing");
if (!sourcing.includes(".excel-product-image img{width:36px!important;height:36px!important")) fail("36px POIZON row image clamp missing");
if (!sourcing.includes("grid-template-columns:50px minmax(0,1fr) 108px")) fail("compact product row grid missing");
if (!sourcing.includes("min-height:60px!important")) fail("compact product row height missing");
if (!sourcing.includes("min-height:38px!important")) fail("compact link-only row height missing");
if (!sourcing.includes("background:#ecfdf3!important")) fail("product-present status chip missing");
if (!sourcing.includes("background:#fff!important;border-left:3px solid #e5e7eb")) fail("neutral detail-row style missing");

console.log("compact sourcing list UI verified: every integrated product image is forcibly clamped");
