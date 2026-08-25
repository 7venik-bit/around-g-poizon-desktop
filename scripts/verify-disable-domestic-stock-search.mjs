import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));

const fail = (message) => { throw new Error(`domestic stock-search verification failed: ${message}`); };

if (!main.includes('const verifyMusinsaInventory = String(source.store || "") === "무신사";')) fail("Musinsa inventory gate is missing");
if (!main.includes('if (verifyMusinsaInventory) await openRenderedSizeOptions(searchWindow);')) fail("size-option interaction is not limited to Musinsa");
if (!main.includes('if (verifyMusinsaInventory && rawStock)')) fail("stock evidence is not limited to Musinsa");
if (!main.includes('stockStatus: "not_searched"')) fail("non-Musinsa stock results are not neutralized");
if (!renderer.includes('const musinsaInventory = String(product?.sourceStore || product?.store || "") === "무신사";')) fail("renderer Musinsa inventory gate is missing");
if (!renderer.includes('const sizes = musinsaInventory ? (product?.sizes || []) : [];')) fail("non-Musinsa size chips are still rendered");
if (!renderer.includes('"재고 확인 안 함"')) fail("non-Musinsa inventory label is missing");
if (!renderer.includes('if (!musinsaSource && matchedProducts.length) return { label: "상품 확인됨"')) fail("non-Musinsa source status still depends on stock");
if (!renderer.includes("무신사 재고만 보기")) fail("stock filter UI is not labelled Musinsa-only");
if (!sourcing.includes("function highestQualifiedSizeReference(products = [])")) fail("highest qualified size-price reference selector is missing");
if (sourcing.includes("products = highestQualifiedSizeRows(products);")) fail("product rows are still being filtered by size-price availability");
if (!sourcing.includes("const highestSizeByIdentity = highestQualifiedSizeReference(products);")) fail("highest size-price reference map is not prepared");
if (!sourcing.includes("const minimumSales = 30;")) fail("size sales minimum is not fixed at 30");
if (!sourcing.includes("<th>사이즈 최고가</th>")) fail("highest size-price column label is missing");
if (!sourcing.includes("<th>국내 상품</th>")) fail("domestic product column label is missing");
if (sourcing.includes("국내 상품 재고 검색")) fail("legacy stock-search wording remains in sourcing view");

console.log("Musinsa-only stock-size verification passed; other retailers use exact product search only");
