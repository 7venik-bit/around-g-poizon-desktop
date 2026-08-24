import { readFile, writeFile } from "node:fs/promises";

const targetPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let source = (await readFile(targetPath, "utf8")).replace(/\r\n/g, "\n");

const replacements = [
  {
    before: "      const matchingProducts = new Map();\n      const domesticVisibleProducts = new Set();\n      let domesticChannelCandidateCount = 0;",
    after: "      const matchingProducts = new Map();\n      const exactMarketplaceProducts = new Set();\n      const domesticVisibleProducts = new Set();\n      let domesticChannelCandidateCount = 0;",
  },
  {
    before: "        const brandMatched = !requiresBrandMatch\n          || brandKeys.some((key) => key.length <= 3 ? tokens.includes(key) : evidence.includes(key));\n        if (/^네이버\\s/.test(String(store || \"\")) && brandMatched && isPlatformShoppingProductUrl(productUrl)) {",
    after: "        const brandMatched = !requiresBrandMatch\n          || brandKeys.some((key) => key.length <= 3 ? tokens.includes(key) : evidence.includes(key));\n        // SSG/Lotte search result cards often expose the manufacturer's exact model number.\n        // Count only full article-number matches; partial variants such as 207521-00 must not\n        // satisfy an exact 207521-001 search. Channel-specific card filtering above still applies.\n        if (/^(?:SSG|롯데온)(?:\\s|$)/.test(String(store || \"\"))\n          && brandMatched\n          && exactArticleIdentityMatch(rawCardText, articleCode)\n          && isPlatformShoppingProductUrl(productUrl)) {\n          exactMarketplaceProducts.add(productUrl);\n        }\n        if (/^네이버\\s/.test(String(store || \"\")) && brandMatched && isPlatformShoppingProductUrl(productUrl)) {",
  },
  {
    before: "      const exactSsgSearchChecked = /^SSG(?:\\s|$)/.test(String(store || \"\")) && cards.length > 0;\n      if (/^네이버\\s/.test(String(store || \"\")) && scopedCountFound && scopedPositiveCount > 0) {",
    after: "      const exactMarketplaceSearchChecked = /^(?:SSG|롯데온)(?:\\s|$)/.test(String(store || \"\")) && cards.length > 0;\n      if (exactMarketplaceProducts.size > 0) {\n        return {\n          count: exactMarketplaceProducts.size,\n          exactModelCount: exactMarketplaceProducts.size,\n          products: [...matchingProducts.values()],\n          presenceConfirmed: true,\n          absenceConfirmed: false,\n          ssgSearchChecked: /^SSG(?:\\s|$)/.test(String(store || \"\")),\n          lotteSearchChecked: /^롯데온(?:\\s|$)/.test(String(store || \"\")),\n        };\n      }\n      if (/^네이버\\s/.test(String(store || \"\")) && scopedCountFound && scopedPositiveCount > 0) {",
  },
  {
    before: "        absenceConfirmed: matchingProducts.size === 0 && exactSsgSearchChecked,\n        ssgSearchChecked: /^SSG(?:\\s|$)/.test(String(store || \"\")),",
    after: "        absenceConfirmed: matchingProducts.size === 0 && exactMarketplaceSearchChecked,\n        ssgSearchChecked: /^SSG(?:\\s|$)/.test(String(store || \"\")),\n        lotteSearchChecked: /^롯데온(?:\\s|$)/.test(String(store || \"\")),",
  },
];

let changed = false;
for (const { before, after } of replacements) {
  if (source.includes(after)) continue;
  const matches = source.split(before).length - 1;
  if (matches !== 1) throw new Error(`Expected exactly one SSG/Lotte patch target, found ${matches}.`);
  source = source.replace(before, after);
  changed = true;
}

if (changed) await writeFile(targetPath, source, "utf8");
console.log(changed
  ? "Patched SSG/Lotte exact-model result counting and channel evidence."
  : "SSG/Lotte exact-model result counting already enabled.");
