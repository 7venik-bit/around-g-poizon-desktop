const KNOWN_ALIASES = [
  ["adidas", "아디다스", "阿迪达斯"],
  ["nike", "나이키", "耐克"],
  ["jordan", "jordanbrand", "조던", "乔丹"],
  ["newbalance", "뉴발란스", "新百伦"],
  ["descente", "데상트", "迪桑特"],
];

export function normalizeBrandName(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function canonicalBrand(value = "") {
  const normalized = normalizeBrandName(value);
  if (!normalized) return "";
  const aliases = KNOWN_ALIASES.find((group) => group.some((alias) => normalizeBrandName(alias) === normalized));
  return aliases ? normalizeBrandName(aliases[0]) : normalized;
}

export function brandsMatch(expected = "", observed = "") {
  const expectedKey = canonicalBrand(expected);
  const observedKey = canonicalBrand(observed);
  if (!expectedKey || !observedKey) return false;
  if (expectedKey === observedKey) return true;
  return expectedKey.length >= 5 && observedKey.length >= 5
    && (expectedKey.includes(observedKey) || observedKey.includes(expectedKey));
}

export function analyzeBrandMatch(expectedBrand = "", products = [], minimumRatio = 0.8) {
  const observedBrands = products
    .map((product) => String(product?.brandName || product?.brand || "").trim())
    .filter(Boolean);
  const counts = new Map();
  let matched = 0;
  for (const observed of observedBrands) {
    counts.set(observed, (counts.get(observed) || 0) + 1);
    if (brandsMatch(expectedBrand, observed)) matched += 1;
  }
  const compared = observedBrands.length;
  const ratio = compared ? matched / compared : 0;
  const dominantBrand = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "";
  return {
    ok: Boolean(normalizeBrandName(expectedBrand)) && compared > 0 && ratio >= minimumRatio,
    expectedBrand: String(expectedBrand || "").trim(),
    dominantBrand,
    matched,
    compared,
    ratio,
  };
}

export function brandMismatchMessage(analysis = {}) {
  const percent = Math.round(Number(analysis.ratio || 0) * 100);
  const actual = analysis.dominantBrand || "브랜드 정보 없음";
  return `브랜드 불일치로 불러오기를 중단했습니다. 요청: ${analysis.expectedBrand || "선택 브랜드"} · Excel 주요 브랜드: ${actual} · 일치율 ${percent}%`;
}
