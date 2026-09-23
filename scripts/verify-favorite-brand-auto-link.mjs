import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

assert.match(main, /runOfficialDomainAudit\(\{ recheckAll = false, brandIds = \[\] \} = \{\}\)/,
  "official-domain audit must accept a targeted brand list");
assert.match(main, /const requestedBrandIds = new Set\(\(Array\.isArray\(brandIds\)/,
  "targeted audit must normalize brand IDs");
assert.match(main, /requestedBrandIds\.has\(Number\(record\.brandId\)\)/,
  "targeted audit must select only requested brands");
assert.match(main, /brandIds: options\?\.brandIds/,
  "IPC must forward the favorite brand IDs into the audit worker");

assert.match(renderer, /function favoriteBrandNeedsAutoLink\(brand\)/,
  "renderer must decide whether a favorite still needs linkage");
assert.match(renderer, /window\.aroundG\.startOfficialDomainAudit\(\{ brandIds: ids, automatic: true \}\)/,
  "favorite linkage must start a targeted audit automatically");
assert.match(renderer, /explorerMeta\.officialDomainAudit\?\.autoPaused/,
  "favorite linkage must respect a user-paused audit");
assert.match(renderer, /if \(result\?\.paused\) \{[\s\S]*favoriteBrandLinkageRequested\.delete\(id\)/,
  "a rejected automatic start must release its request guard");
assert.match(renderer, /void queueFavoriteBrandSiteLinkage\(pinnedBrandIds\);/,
  "persisted or download-complete favorite brands must trigger linkage");
assert.match(renderer, /favoriteBrandLinkageRequested\.delete\(Number\(audit\.updatedBrand\.brandId\)\)/,
  "completed brand updates must release the in-memory request guard");

// Terminal states must not be needlessly re-audited on every render. Verified
// brands are considered complete only when their actual search adapter is also ready.
assert.match(renderer, /\["verified", "search_unsupported"\]\.includes\(domainStatus\)[\s\S]*\["dedicated", "common"\]\.includes\(adapterStatus\)/,
  "verified favorites still need linkage until a dedicated/common adapter is ready");
assert.match(renderer, /\["no_official_store"\]\.includes\(domainStatus\)/,
  "a confirmed no-official-store verdict must not loop forever");

console.log("Favorite brand auto-link verified: every persisted/frequent favorite starts only its pending official-site linkage automatically; verified adapters and confirmed no-store brands are not repeated");
