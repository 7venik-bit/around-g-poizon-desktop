import { readFile, writeFile } from "node:fs/promises";

const targetPath = new URL("../relay/domestic-search.mjs", import.meta.url);
const source = await readFile(targetPath, "utf8");

const desiredOrder = [
  '{ store: "무신사", parser: parseMusinsaSearch, renderCount: true }',
  'store: officialStoreLabel',
  '{ store: "네이버 공식 브랜드스토어", linkOnly: true, fashionTown: "brand-store", renderCount: true }',
  '{ store: "SSG", linkOnly: true, domesticChannel: "ssg-general", renderCount: true }',
  '{ store: "롯데온", linkOnly: true, domesticChannel: "lotte-general", renderCount: true }',
  '{ store: "코오롱몰", parser: (html) => parseKolonSearch(html, articleNumber) }',
  '{ store: "병행수입·편집샵", linkOnly: true, retailerDiscovery: true, renderCount: true }',
];

const sourceListPattern = /(\s{2}const sources = \[\r?\n)([\s\S]*?)(\r?\n\s{2}\];\r?\n\s{2}\/\/ Keep the source order observable and deterministic\.)/;
const match = source.match(sourceListPattern);
if (!match) throw new Error("Domestic source list block not found.");

const currentBlock = match[2];
let cursor = -1;
const alreadyOrdered = desiredOrder.every((needle) => {
  const next = currentBlock.indexOf(needle, cursor + 1);
  if (next < 0) return false;
  cursor = next;
  return true;
});

if (alreadyOrdered) {
  console.log("Domestic result order already applied; no changes needed.");
  process.exit(0);
}

const eol = source.includes("\r\n") ? "\r\n" : "\n";
const replacementLines = [
  '  const sources = [',
  '    { store: "무신사", parser: parseMusinsaSearch, renderCount: true },',
  '    {',
  '      store: officialStoreLabel,',
  '      linkOnly: true,',
  '      officialBrand: true,',
  '      renderCount: [OFFICIAL_DOMAIN_STATUS.VERIFIED, OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED].includes(officialStatus)',
  '        && Boolean(String(officialBrandRecord?.homepageUrl || knownOfficial?.homepageUrl || "")),',
  '      officialStatus,',
  '      homepageUrl: String(officialBrandRecord?.homepageUrl || knownOfficial?.homepageUrl || ""),',
  '    },',
  '    { store: "네이버 공식 브랜드스토어", linkOnly: true, fashionTown: "brand-store", renderCount: true },',
  '    { store: "네이버 백화점", linkOnly: true, fashionTown: "department", renderCount: true },',
  '    { store: "네이버 아울렛", linkOnly: true, fashionTown: "outlet", renderCount: true },',
  '    { store: "SSG", linkOnly: true, domesticChannel: "ssg-general", renderCount: true },',
  '    { store: "SSG 백화점", linkOnly: true, domesticChannel: "ssg-department", renderCount: true },',
  '    { store: "SSG 아울렛", linkOnly: true, domesticChannel: "ssg-outlet", renderCount: true },',
  '    { store: "롯데온", linkOnly: true, domesticChannel: "lotte-general", renderCount: true },',
  '    { store: "롯데온 백화점", linkOnly: true, domesticChannel: "lotte-department", renderCount: true },',
  '    { store: "롯데온 아울렛", linkOnly: true, domesticChannel: "lotte-outlet", renderCount: true },',
  '    { store: "코오롱몰", parser: (html) => parseKolonSearch(html, articleNumber) },',
  '    { store: "병행수입·편집샵", linkOnly: true, retailerDiscovery: true, renderCount: true },',
  '  ];',
].join(eol);

const patched = source.replace(sourceListPattern, `${replacementLines}${eol}  // Keep the source order observable and deterministic.`);
await writeFile(targetPath, patched, "utf8");
console.log("Domestic result order patched: Musinsa -> official brand mall -> Naver -> SSG -> Lotte -> Kolon (parallel import remains last).");
