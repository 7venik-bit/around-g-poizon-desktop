import { VERIFIED_OFFICIAL_BRANDS } from "./official-domain-registry.mjs";

// The popular-products export has a brand column, but POIZON often leaves it
// empty even when the product title begins with an unambiguous brand name.
export function popularSearchBrand(title = "") {
  const name = String(title || "").trim();
  const aliases = VERIFIED_OFFICIAL_BRANDS.flatMap((brand) =>
    brand.aliases.map((alias) => ({ brand: brand.name, alias: String(alias) }))
  ).filter(({ alias }) => alias.length >= 3)
    .sort((a, b) => b.alias.length - a.alias.length);
  return aliases.find(({ alias }) =>
    name.toLowerCase().startsWith(alias.toLowerCase())
    && (name.length === alias.length || /[\s\[(/-]/.test(name[alias.length]))
  )?.brand || "";
}

export function popularSearchArticle(articleNumber = "", brand = "") {
  const raw = String(articleNumber || "").trim();
  if (!/^(?:crocs|크록스)$/i.test(String(brand || "").trim())) return raw;
  // POIZON may split the three-digit Crocs colour code and append a colour
  // word: "207521-0 01 BLACK". Keep the workbook's original value; use the
  // normalized article only for the domestic search and identity comparison.
  const crocs = raw.match(/^(\d{6})-\s*(\d)\s*(\d{2})(?:\s+[A-Za-z][A-Za-z\s-]*)?$/i);
  return crocs ? `${crocs[1]}-${crocs[2]}${crocs[3]}` : raw;
}
