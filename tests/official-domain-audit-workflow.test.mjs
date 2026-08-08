import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the desktop can audit every official domain with checkpoints and safe pauses", async () => {
  const [mainSource, preloadSource, rendererSource, htmlSource] = await Promise.all([
    readFile(new URL("../main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(mainSource, /async function runOfficialDomainAudit/);
  assert.match(mainSource, /officialDomainAuditQueue\(registry\)/);
  assert.match(mainSource, /for \(const index of auditQueue\)/);
  assert.match(mainSource, /await persistOfficialDomainAudit/);
  assert.match(mainSource, /await wait\(4_000\)/);
  assert.match(mainSource, /DISCOVERY_BLOCKED/);
  assert.match(mainSource, /OFFICIAL_DOMAIN_AUDIT_COOLDOWN_MS/);
  assert.match(mainSource, /officialDomainAuditResumeTimer/);
  assert.match(mainSource, /compareOfficialBrandLogos/);
  assert.match(mainSource, /brandLogoUrl/);
  assert.match(mainSource, /logoSimilarity/);
  assert.match(mainSource, /official-domain:audit-start/);
  assert.match(mainSource, /official-domain:audit-stop/);
  assert.match(preloadSource, /startOfficialDomainAudit/);
  assert.match(preloadSource, /onOfficialDomainAuditProgress/);
  assert.match(rendererSource, /renderOfficialDomainAudit/);
  assert.match(rendererSource, /검증 일시 정지/);
  assert.match(rendererSource, /자동 재개/);
  assert.match(rendererSource, /startOfficialDomainAudit/);
  assert.match(htmlSource, /id="official-domain-audit-toggle"/);
  assert.match(htmlSource, /공식몰 전체 검증/);
});

test("full verification starts after the complete brand catalog is available", async () => {
  const rendererSource = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  assert.match(rendererSource, /if \(explorerMeta\.needsBrandSync\) await syncFullBrandCatalog/);
  assert.match(rendererSource, /officialDomainAudit\?\.unchecked/);
  assert.match(rendererSource, /await window\.aroundG\.startOfficialDomainAudit/);
});
