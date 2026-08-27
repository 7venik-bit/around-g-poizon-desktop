import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`domestic detail image hard clamp verification failed: ${message}`); };

if (!sourcing.includes("data-around-g-domestic-image-clamp")) fail("runtime marker missing");
if (!sourcing.includes("#excel-preview-rows .excel-product-search-detail img")) fail("Excel domestic-detail selector missing");
if (!sourcing.includes("#explorer-product-grid .domestic-inventory img")) fail("explorer domestic-detail selector missing");
if (!sourcing.includes('style.setProperty("width", "44px", "important")')) fail("inline important width clamp missing");
if (!sourcing.includes('style.setProperty("height", "44px", "important")')) fail("inline important height clamp missing");
if (!sourcing.includes("new MutationObserver")) fail("runtime mutation observer missing");
if (!sourcing.includes("observer.observe(root, { childList: true, subtree: true })")) fail("dynamic result observation missing");

console.log("domestic detail image runtime hard clamp verified");
