import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`product image/text alignment verification failed: ${message}`); };

if (!sourcing.includes("data-product-image-text-alignment")) fail("alignment marker missing");
if (!sourcing.includes(".candidate-summary,")) fail("candidate image/text alignment missing");
if (!sourcing.includes(".sourcing-product-list-row{align-items:start!important}")) fail("domestic row top alignment missing");
if (!sourcing.includes(".sourcing-product-thumb{align-self:start!important;margin-top:0!important}")) fail("domestic thumbnail alignment missing");
if (!sourcing.includes(".sourcing-product-info{align-self:start!important")) fail("domestic text block alignment missing");
if (!sourcing.includes(".sourcing-product-actions{align-self:center!important}")) fail("domestic actions alignment missing");

console.log("product image/text alignment verified");
