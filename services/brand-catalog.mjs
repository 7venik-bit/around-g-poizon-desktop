export const FULL_BRAND_CATALOG_MINIMUM = 3300;
export const BRAND_CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function brandCatalogNeedsSync(brands, updatedAt = "", now = Date.now()) {
  if (!Array.isArray(brands) || brands.length < FULL_BRAND_CATALOG_MINIMUM) return true;
  const updatedTime = Date.parse(String(updatedAt || ""));
  return !Number.isFinite(updatedTime) || Math.max(0, Number(now) - updatedTime) > BRAND_CATALOG_MAX_AGE_MS;
}

export function parseKrPoizonBrandData(input) {
  const root = typeof input === "string" ? JSON.parse(input) : input;
  const found = new Map();
  const visit = (value, depth = 0) => {
    if (!value || depth > 14) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const id = Number(value.brandId ?? value.id);
    const name = String(value.name ?? value.brandName ?? "").trim();
    if (Number.isSafeInteger(id) && id > 0 && name && (
      "brandId" in value || /brand/i.test(String(value.brandUrl || ""))
    )) {
      found.set(id, {
        id,
        name: String(value.nameEn || value.englishName || name).trim(),
        ko: name,
        logoUrl: String(value.icon || value.logoUrl || ""),
        productUrl: String(value.brandUrl || value.routerUrl || ""),
      });
    }
    for (const nested of Object.values(value)) visit(nested, depth + 1);
  };
  visit(root);
  return [...found.values()].sort((left, right) =>
    left.ko.localeCompare(right.ko, "ko", { sensitivity: "base" })
  );
}

const GLOBAL_BRAND_PRIORITY = [
  "Nike", "Adidas", "Jordan", "New Balance", "Puma", "ASICS",
  "Under Armour", "Lululemon", "Skechers", "Converse", "Vans", "Crocs",
  "Salomon", "HOKA", "On", "The North Face", "Columbia", "Patagonia", "Arc'teryx",
  "Louis Vuitton", "Chanel", "Gucci", "Dior", "Hermes", "Prada",
  "Saint Laurent", "Balenciaga", "Burberry", "CELINE", "Coach",
  "Michael Kors", "Ralph Lauren", "Tommy Hilfiger", "Calvin Klein", "FILA", "Reebok",
];

function normalizedBrandName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

const GLOBAL_BRAND_RANK = new Map(
  GLOBAL_BRAND_PRIORITY.map((name, index) => [normalizedBrandName(name), index])
);

export function prioritizeBrandCatalog(brands) {
  return [...(brands || [])].sort((left, right) => {
    const leftRank = GLOBAL_BRAND_RANK.get(normalizedBrandName(left.name));
    const rightRank = GLOBAL_BRAND_RANK.get(normalizedBrandName(right.name));
    const leftPriority = leftRank ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = rightRank ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return String(left.name || "").localeCompare(String(right.name || ""), "en", { sensitivity: "base" });
  }).map((brand) => ({
    ...brand,
    globalMajor: GLOBAL_BRAND_RANK.has(normalizedBrandName(brand.name)),
  }));
}

export function mergeLocalizedBrandCatalog(koreanBrands, englishBrands) {
  const englishById = new Map((englishBrands || []).map((brand) => [Number(brand.id), brand]));
  return prioritizeBrandCatalog((koreanBrands || []).map((brand) => {
    const english = englishById.get(Number(brand.id));
    return {
      ...brand,
      name: String(english?.name || brand.name || brand.ko || "").trim(),
      ko: String(brand.ko || brand.name || "").trim(),
      logoUrl: String(brand.logoUrl || english?.logoUrl || ""),
      productUrl: String(
        english?.productUrl && english.productUrl !== "/brand/"
          ? english.productUrl
          : `/brand/${String(english?.name || brand.name || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")}`
      ),
    };
  }));
}

export function publicBrandPath(brand) {
  const savedPath = String(brand?.productUrl || brand?.brandUrl || "").trim();
  if (/^\/brand\/[a-z0-9][a-z0-9-]*$/i.test(savedPath)) return savedPath;
  const slug = String(brand?.name || brand?.brandName || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? `/brand/${slug}` : "";
}

export function publicBrandPageCount(total, pageSize, maximum = 100) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safePageSize = Math.max(1, Number(pageSize) || 1);
  return Math.min(Math.max(1, Number(maximum) || 1), Math.max(1, Math.ceil(safeTotal / safePageSize)));
}

function priceNumber(value) {
  const candidates = [
    value?.minSpuPrice?.money?.minUnitVal,
    value?.minSpuPrice?.money?.amount,
    value?.minSpuPrice?.amountText,
    value?.price,
  ];
  for (const candidate of candidates) {
    const number = Number(String(candidate ?? "").replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

export function parsePublicBrandProducts(input, expectedBrandId) {
  const root = typeof input === "string" ? JSON.parse(input) : input;
  const products = new Map();
  const visit = (value, depth = 0) => {
    if (!value || depth > 16) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const articleNumber = String(value.articleNumber || "").trim();
    const title = String(value.title || value.name || "").trim();
    const brandId = Number(value.brandId);
    if (articleNumber && title && (!expectedBrandId || brandId === Number(expectedBrandId))) {
      const id = String(value.globalSpuId || value.spuId || value.id || articleNumber);
      products.set(`${articleNumber}:${id}`, {
        articleNumber,
        title,
        name: title,
        brandId,
        spuId: String(value.spuId || ""),
        globalSpuId: String(value.globalSpuId || ""),
        logoUrl: String(value.logoUrl || value.imageUrl || ""),
        averagePrice: priceNumber(value),
        categoryName: String(value.categoryName || ""),
        source: "kr-poizon-public-brand",
      });
    }
    for (const nested of Object.values(value)) visit(nested, depth + 1);
  };
  visit(root);
  return [...products.values()];
}
