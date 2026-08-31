import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`official/naver link-only verification failed: ${message}`); };

if (!main.includes('const linkOnlySource = String(product?.store || "") === "브랜드 공식몰"')) fail("official mall link-only guard missing");
if (!main.includes('/^네이버\\s/.test(String(product?.store || ""))')) fail("Naver link-only guard missing");
if (!main.includes('linkOnly: true')) fail("link-only result marker missing");
if (!main.includes('linkVerified: /^https?:\\/\\//i.test(String(product?.url || ""))')) fail("real URL verification marker missing");
if (!sourcing.includes('sourceStore === "브랜드 공식몰" ? candidateName : "검색 결과 링크"')) fail("official title and search-link title split missing");
if (!sourcing.includes('<span class="sourcing-price-unknown">–</span>')) fail("non-price official fields must stay visually empty");
if (!sourcing.includes('sourceAction(source, product, "열기")')) fail("result link action missing");
if (!sourcing.includes('simpleLinkResult')) fail("simple official/Naver renderer missing");

console.log("official/Naver link-only result verified in the price-comparison table");
