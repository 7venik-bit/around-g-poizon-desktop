import { readFile, writeFile } from "node:fs/promises";

const targetPath = new URL("../relay/domestic-search.mjs", import.meta.url);
const source = await readFile(targetPath, "utf8");

const startMarker = "  const sources = [\n";
const endMarker = "  ];\n  // Keep the source order observable and deterministic.";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("Domestic source list block not found.");

const replacement = `  const sources = [
    { store: "무신사", parser: parseMusinsaSearch, renderCount: true },
    {
      store: officialStoreLabel,
      linkOnly: true,
      officialBrand: true,
      renderCount: [OFFICIAL_DOMAIN_STATUS.VERIFIED, OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED].includes(officialStatus)
        && Boolean(String(officialBrandRecord?.homepageUrl || knownOfficial?.homepageUrl || "")),
      officialStatus,
      homepageUrl: String(officialBrandRecord?.homepageUrl || knownOfficial?.homepageUrl || ""),
    },
    { store: "네이버 공식 브랜드스토어", linkOnly: true, fashionTown: "brand-store", renderCount: true },
    { store: "네이버 백화점", linkOnly: true, fashionTown: "department", renderCount: true },
    { store: "네이버 아울렛", linkOnly: true, fashionTown: "outlet", renderCount: true },
    { store: "SSG", linkOnly: true, domesticChannel: "ssg-general", renderCount: true },
    { store: "SSG 백화점", linkOnly: true, domesticChannel: "ssg-department", renderCount: true },
    { store: "SSG 아울렛", linkOnly: true, domesticChannel: "ssg-outlet", renderCount: true },
    { store: "롯데온", linkOnly: true, domesticChannel: "lotte-general", renderCount: true },
    { store: "롯데온 백화점", linkOnly: true, domesticChannel: "lotte-department", renderCount: true },
    { store: "롯데온 아울렛", linkOnly: true, domesticChannel: "lotte-outlet", renderCount: true },
    { store: "코오롱몰", parser: (html) => parseKolonSearch(html, articleNumber) },
    { store: "병행수입·편집샵", linkOnly: true, retailerDiscovery: true, renderCount: true },
  ];
`;

const patched = source.slice(0, start) + replacement + source.slice(end + "  ];\n".length);
await writeFile(targetPath, patched, "utf8");
console.log("Domestic result order patched: Musinsa -> official brand mall -> Naver -> SSG -> Lotte -> Kolon (parallel import remains last). ");
