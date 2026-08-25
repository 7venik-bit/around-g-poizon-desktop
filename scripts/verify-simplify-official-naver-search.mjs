import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const relay = String(await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`simplified official/Naver search verification failed: ${message}`); };

if (!main.includes('sanitizeDomesticQuery([title, articleNumber].filter(Boolean).join(" "))')) {
  fail("official mall does not use product name plus product code only");
}
if (!relay.includes('{ store: "네이버 패션타운", linkOnly: true, fashionTown: "brand-store", renderCount: true }')) {
  fail("single Naver Fashion Town source is missing");
}
const sourceBlock = relay.match(/const sources = \[[\s\S]*?\n  \];/)?.[0] || "";
if (!sourceBlock) fail("domestic source list was not found");
for (const removed of ["네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛"]) {
  if (sourceBlock.includes(`store: "${removed}"`)) fail(`${removed} is still searched as a separate source`);
}
if (main.includes('"네이버 패션타운" ? await ensureNaverOfficialBrandFilter')) {
  fail("Naver Fashion Town still triggers official-brand channel filtering");
}
console.log("simplified official mall and Naver Fashion Town search verification passed");
