import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) {
    if (source.includes(after)) return source;
    throw new Error(`FAVORITE_AUTO_LINK patch target missing: ${label}`);
  }
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`FAVORITE_AUTO_LINK patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(
  main,
  "async function runOfficialDomainAudit({ recheckAll = false } = {}) {",
  "async function runOfficialDomainAudit({ recheckAll = false, brandIds = [] } = {}) {",
  "targeted official-domain audit signature",
);
main = replaceOnce(
  main,
  `    const auditQueue = recheckAll\n      ? registry.map((record, index) => ({ record, index }))\n        .filter(({ record }) => Date.parse(record.lastCheckedAt || 0) < startedAtMs)\n        .map(({ index }) => index)\n      : officialDomainAuditQueue(registry);`,
  `    const requestedBrandIds = new Set((Array.isArray(brandIds) ? brandIds : [])\n      .map(Number).filter(Number.isFinite));\n    const auditQueue = requestedBrandIds.size\n      ? registry.map((record, index) => ({ record, index }))\n        .filter(({ record }) => requestedBrandIds.has(Number(record.brandId)))\n        .map(({ index }) => index)\n      : recheckAll\n        ? registry.map((record, index) => ({ record, index }))\n          .filter(({ record }) => Date.parse(record.lastCheckedAt || 0) < startedAtMs)\n          .map(({ index }) => index)\n        : officialDomainAuditQueue(registry);`,
  "targeted official-domain audit queue",
);
main = replaceOnce(
  main,
  "if (!officialDomainAuditRunning) void runOfficialDomainAudit({ recheckAll: options?.recheckAll === true });",
  "if (!officialDomainAuditRunning) void runOfficialDomainAudit({ recheckAll: options?.recheckAll === true, brandIds: options?.brandIds });",
  "targeted official-domain IPC start",
);
await writeFile(mainPath, main, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));
renderer = replaceOnce(
  renderer,
  "let favoriteCatalogFallbackActive = false;",
  `let favoriteCatalogFallbackActive = false;\nconst favoriteBrandLinkageRequested = new Set();\n\nfunction favoriteBrandNeedsAutoLink(brand) {\n  if (!brand || brand.recoveryFallback) return false;\n  const domainStatus = String(brand.officialDomainStatus || "pending");\n  const adapterStatus = String(brand.officialAdapterStatus || "pending");\n  if (["no_official_store"].includes(domainStatus)) return false;\n  if (["verified", "search_unsupported"].includes(domainStatus)\n    && ["dedicated", "common"].includes(adapterStatus)) return false;\n  return true;\n}\n\nasync function queueFavoriteBrandSiteLinkage(brandIds = []) {\n  if (!window.aroundG?.startOfficialDomainAudit || favoriteCatalogFallbackActive) return;\n  const ids = [...new Set((Array.isArray(brandIds) ? brandIds : []).map(Number).filter(Number.isFinite))]\n    .filter((id) => !favoriteBrandLinkageRequested.has(id))\n    .filter((id) => favoriteBrandNeedsAutoLink(explorerMeta.brands.find((brand) => Number(brand.id) === id)));\n  if (!ids.length) return;\n  ids.forEach((id) => favoriteBrandLinkageRequested.add(id));\n  try {\n    const result = await window.aroundG.startOfficialDomainAudit({ brandIds: ids, automatic: true });\n    if (result?.audit) renderOfficialDomainAudit(result.audit);\n  } catch (error) {\n    ids.forEach((id) => favoriteBrandLinkageRequested.delete(id));\n    console.warn("즐겨찾기 브랜드 자동 연동을 시작하지 못했습니다.", String(error?.message || error || ""));\n  }\n}`,
  "favorite auto-link helper",
);
renderer = replaceOnce(
  renderer,
  `  localStorage.setItem("around-g-brand-selection-history", JSON.stringify(brandSelectionHistory.slice(0, 100)));\n}`,
  `  localStorage.setItem("around-g-brand-selection-history", JSON.stringify(brandSelectionHistory.slice(0, 100)));\n  // Any current or future favorite UI that persists pinnedBrandIds automatically\n  // starts site linkage for only the brands that still need it.\n  void queueFavoriteBrandSiteLinkage(pinnedBrandIds);\n}`,
  "favorite save triggers automatic linkage",
);
renderer = replaceOnce(
  renderer,
  `  const completedBrands = completedDownloadBrands();\n  const completedOrder = new Map(completedBrands.map((brand, index) => [Number(brand.id), index]));\n  pinnedBrandIds = completedBrands.map((brand) => Number(brand.id));`,
  `  const completedBrands = completedDownloadBrands();\n  const completedOrder = new Map(completedBrands.map((brand, index) => [Number(brand.id), index]));\n  pinnedBrandIds = completedBrands.map((brand) => Number(brand.id));\n  // Download-complete brands are the current frequent/favorite set. On startup\n  // and whenever a new brand enters this set, prepare its official-site adapter\n  // automatically instead of waiting for the manual full-domain audit button.\n  void queueFavoriteBrandSiteLinkage(pinnedBrandIds);`,
  "frequent brand list triggers automatic linkage",
);
renderer = replaceOnce(
  renderer,
  `    if (audit?.updatedBrand) {\n      const updated = explorerMeta.brands.find((brand) => Number(brand.id) === Number(audit.updatedBrand.brandId));`,
  `    if (audit?.updatedBrand) {\n      favoriteBrandLinkageRequested.delete(Number(audit.updatedBrand.brandId));\n      const updated = explorerMeta.brands.find((brand) => Number(brand.id) === Number(audit.updatedBrand.brandId));`,
  "release favorite linkage request after audit update",
);
await writeFile(rendererPath, renderer, "utf8");

console.log("Favorite brand auto-link patch applied: pinned/download-complete brands trigger targeted official-site linkage automatically");
