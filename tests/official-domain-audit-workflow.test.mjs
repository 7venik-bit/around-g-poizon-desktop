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
  assert.match(rendererSource, /\$\("#brand-sync"\)\.addEventListener\("click", \(\) => syncFullBrandCatalog\(\)\)/);
  assert.doesNotMatch(rendererSource, /startVerification/);
  assert.match(rendererSource, /async function syncFullBrandCatalog\(\{ automatic = false \} = \{\}\)/);
  assert.match(mainSource, /partition: "persist:around-g-official-domain-audit"[\s\S]*disableDialogs: true/);
  assert.doesNotMatch(mainSource, /setTimeout\(\(\) => \{\s*officialDomainAuditResumeTimer = null;\s*void runOfficialDomainAudit/);
});

test("full verification has no startup, update, or overnight automatic trigger", async () => {
  const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(mainSource, /scheduleImmediateOfficialMallLinkage/);
  assert.doesNotMatch(mainSource, /startImmediateOfficialMallLinkage/);
  assert.doesNotMatch(mainSource, /immediateOfficialMallLinkageTimer/);
  assert.doesNotMatch(mainSource, /nextOfficialMallAuditStartAt/);
  assert.match(mainSource, /ipcMain\.handle\("official-domain:audit-start"/);
  assert.match(mainSource, /Full official-mall verification is manual-only/);
});
