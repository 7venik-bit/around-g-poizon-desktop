import { createOfficialDomainRegistry, officialDomainRecordForBrand, normalizeOfficialBrand } from './official-domain-registry.mjs';
import { officialMallAdapterRecord } from './official-mall-adapters.mjs';

// Resolve only the requested brand. This is independent of the full-domain
// maintenance audit and never opens POIZON or reads/writes an Excel workbook.
export function requestedOfficialBrand(input = {}, settings = {}) {
  const brand = String(input.brand || '').trim();
  const catalog = settings.brandCatalog || [];
  const key = normalizeOfficialBrand(brand);
  const entry = catalog.find(row => Number(input.brandId) > 0 && Number(row.id) === Number(input.brandId))
    || (key && catalog.find(row => [row.name, row.ko].some(name => normalizeOfficialBrand(name) === key)))
    || {id: input.brandId, name: brand, ko: brand};
  if (!String(entry.name || entry.ko || '').trim()) return null;
  const saved = officialDomainRecordForBrand(settings.officialBrandRegistry, entry.name)
    || officialDomainRecordForBrand(settings.officialBrandRegistry, entry.ko);
  return officialMallAdapterRecord(createOfficialDomainRegistry([entry], saved ? [saved] : [])[0]);
}

export async function resolveBrandOfficialSearch({input = {}, settings = {}, discover, persist = async () => {}, canceled = () => false, now = Date.now()}) {
  const record = requestedOfficialBrand(input, settings);
  if (!record || input.verifyLinkCounts !== true
    || (Array.isArray(input.sourceGroups) && !input.sourceGroups.includes('official'))) return record;
  if (['verified', 'search_unsupported'].includes(record.status) && record.homepageUrl) return record;
  // A transient network failure is not evidence that a brand has no store.
  // Reuse a recent failed attempt briefly; a later search resumes discovery.
  const checked = Date.parse(record.lastCheckedAt || '');
  if (Number.isFinite(checked) && now - checked >= 0 && now - checked < 15 * 60_000) return record;
  if (canceled()) throw new Error('DOMESTIC_SEARCH_CANCELED');
  const result = await discover(record);
  if (canceled()) throw new Error('DOMESTIC_SEARCH_CANCELED');
  const resolved = officialMallAdapterRecord(result?.record || record);
  // Adapter absence does not disable a discovered storefront: its actual
  // search form or interactive search remains available to this brand.
  if (resolved.status === 'search_unsupported' && resolved.homepageUrl) resolved.interactiveSearch = true;
  try { await persist(resolved); }
  catch (error) { resolved.searchPersistenceError = String(error?.message || error); }
  return resolved;
}
