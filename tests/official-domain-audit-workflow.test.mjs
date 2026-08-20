import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


test("full verification remains stopped after startup until the user continues it", async () => {
  const [rendererSource, mainSource] = await Promise.all([
    readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(rendererSource, /if \(explorerMeta\.needsBrandSync\) await syncFullBrandCatalog/);
  assert.match(rendererSource, /네이버 검색 중/);
  assert.match(rendererSource, /공식 홈페이지 연결 확인 중/);
  assert.match(rendererSource, /2차 확인/);
  const startup = rendererSource.slice(rendererSource.lastIndexOf("(async () => {"));
  assert.doesNotMatch(startup, /startOfficialDomainAudit/);
  assert.match(rendererSource, /official-domain-audit-toggle/);
  assert.match(rendererSource, /await window\.aroundG\.startOfficialDomainAudit/);
  assert.match(rendererSource, /syncFullBrandCatalog\(\{ startVerification: true \}\)/);
  assert.match(rendererSource, /if \(startVerification\) \{[\s\S]*startOfficialDomainAudit/);
  assert.match(rendererSource, /automatic = false, startVerification = !automatic/);
  assert.match(mainSource, /partition: "persist:around-g-official-domain-audit"[\s\S]*disableDialogs: true/);
  assert.doesNotMatch(mainSource, /setTimeout\(\(\) => \{\s*officialDomainAuditResumeTimer = null;\s*void runOfficialDomainAudit/);
});

test("an interrupted version audit is not marked complete while brands remain pending", async () => {
  const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  const start = mainSource.indexOf("async function startImmediateOfficialMallLinkage");
  const end = mainSource.indexOf("function pauseOfficialDomainAuditForSellerAutomation", start);
  const linkage = mainSource.slice(start, end);

  assert.match(linkage, /immediateOfficialMallLinkageVersion === version && !initialSummary\.pending/);
  assert.match(linkage, /await runOfficialDomainAudit\(\)/);
  assert.match(linkage, /if \(!completedSummary\.pending\)/);
  assert.match(linkage, /immediateOfficialMallLinkageCompletedAt/);
});

test("automatic full verification is scheduled overnight and stopped before daytime work", async () => {
  const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  assert.match(mainSource, /if \(app\.isPackaged\) scheduleImmediateOfficialMallLinkage\(\)/);
  assert.doesNotMatch(mainSource, /setTimeout\(\(\) => void startImmediateOfficialMallLinkage\(\), 8_000\)/);
  assert.match(mainSource, /nextOfficialMallAuditStartAt\(now\)/);
  assert.match(mainSource, /currentOfficialMallAuditEndAt\(new Date\(\)\)/);
  assert.match(mainSource, /stopAutomaticOfficialMallLinkage\(\)/);
});
