import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`product image/text alignment verification failed: ${message}`); };

if (!sourcing.includes("data-product-image-text-alignment")) fail("alignment marker missing");
if (!sourcing.includes(".candidate-summary{")) fail("candidate layout missing");
if (!sourcing.includes("display:flex!important;\n      flex-direction:row!important;")) fail("horizontal flex layout missing");
if (!sourcing.includes(".sourcing-product-list-row{")) fail("domestic product row layout missing");
if (!sourcing.includes(".sourcing-product-thumb{\n      flex:0 0 44px!important")) fail("domestic thumbnail left column missing");
if (!sourcing.includes(".sourcing-product-info{\n      display:flex!important;\n      flex:1 1 auto!important")) fail("domestic text block right column missing");
if (!sourcing.includes(".sourcing-product-actions{\n      flex:0 0 100px!important")) fail("domestic action column missing");
if (!sourcing.includes("#excel-preview-grid .excel-product-row .excel-product-image+td")) fail("Excel image/text top-line alignment missing");

console.log("product image-left text-right layout verified");
