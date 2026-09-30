import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function auditOneOfficialDomain(");
const end = source.indexOf("\nasync function resolveDomesticOfficialBrand(", start);
const auditOneOfficialDomain = vm.runInNewContext(`(${source.slice(start, end)})`, {
  URL,
  OFFICIAL_DOMAIN_STATUS: { VERIFIED: "verified", SEARCH_UNSUPPORTED: "search_unsupported" },
});

test("restricted official homepage remains recorded but does not block the next brand", async () => {
  const audit = vm.runInNewContext(`(${source.slice(start, end)})`, {
    URL,
    Date,
    OFFICIAL_DOMAIN_STATUS: { VERIFIED: "verified", SEARCH_UNSUPPORTED: "search_unsupported" },
    loadAuditPage: async () => ({ blocked: true }),
  });
  const record = { brandName: "Example", status: "verified", homepageUrl: "https://example.com/", verificationAttempts: 2 };
  const result = await audit(null, record);
  assert.equal(result.skipped, true);
  assert.equal(result.blocked, false);
  assert.equal(result.record.status, "verified");
  assert.equal(result.record.lastVerificationError, "OFFICIAL_PAGE_ACCESS_RESTRICTED");
  assert.equal(result.record.verificationAttempts, 3);
});

test("blocked discovery skips unresolved brands without another access attempt", async () => {
  const record = { brandName: "Another Brand", status: "pending", verificationAttempts: 0 };
  const result = await auditOneOfficialDomain(null, record, () => {}, { skipDiscovery: true });
  assert.equal(result.skipped, true);
  assert.equal(result.record.status, "pending");
  assert.equal(result.record.lastVerificationError, "DISCOVERY_SKIPPED_ACCESS_RESTRICTED");
  assert.equal(result.record.lastCheckedAt, undefined);
  assert.equal(result.record.verificationAttempts, 0);
});

test("a blocked discovery does not end the audit queue", () => {
  assert.match(source, /if \(result\.blocked\) discoveryBlocked = true/);
  assert.match(source, /auditOneOfficialDomain\(activeWindow, record, progress, \{ skipDiscovery: discoveryBlocked \}\)/);
  const loop = source.slice(source.indexOf("for (const index of auditQueue)"), source.indexOf("} finally {\n    officialDomainAuditAbortCurrent"));
  assert.doesNotMatch(loop, /if \(result\?\.blocked\) break/);
  assert.match(loop, /!result\.blocked && !result\.skipped/);
  assert.match(loop, /if \(!result\?\.skipped\) await wait/);
});
