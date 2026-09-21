import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('an empty official audit durably saves its final total and releases the running state', async () => {
  const main = (await readFile(new URL('../main.mjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = main.indexOf('async function runOfficialDomainAudit(');
  const end = main.indexOf('\n}\n', start) + 2;
  const saves = [];
  let destroyed = false;
  const context = vm.createContext({
    clearTimeout, officialDomainAuditResumeTimer:null,
    officialDomainAuditRunning:false, officialDomainAuditStopRequested:false,
    officialDomainAuditWindow:null, officialDomainAuditAbortCurrent:null,
    store:{snapshot:()=>({settings:{brandCatalog:[]}})},
    ensureOfficialDomainRegistry:async()=>[], officialDomainAuditQueue:()=>[],
    createOfficialDomainAuditWindow:()=>({isDestroyed:()=>destroyed,destroy:()=>{destroyed=true;}}),
    persistOfficialDomainAudit:async(_registry,state)=>saves.push(state),
    officialDomainRegistrySummary:()=>({pending:0,unchecked:0}),
    exportNaverOfficialStoreNotFoundExcel:async()=>({path:'report.xlsx',count:0}),
    sendOfficialDomainAuditProgress:()=>{},
  });
  vm.runInContext(main.slice(start,end), context);
  await context.runOfficialDomainAudit();
  assert.equal(saves.at(-1).state, 'completed');
  assert.equal(saves.at(-1).runTotal, 0);
  assert.equal(context.officialDomainAuditRunning, false);
  assert.equal(destroyed, true);
});
