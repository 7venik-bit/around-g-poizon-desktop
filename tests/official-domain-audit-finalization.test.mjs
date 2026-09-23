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

test('official audit stays busy until its report and final progress are saved', async () => {
  const main = (await readFile(new URL('../main.mjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = main.indexOf('async function runOfficialDomainAudit(');
  const end = main.indexOf('\n}\n', start) + 2;
  let finishExport;
  const exportPending = new Promise((resolve) => { finishExport = resolve; });
  let exportStarted;
  const exporting = new Promise((resolve) => { exportStarted = resolve; });
  const progress = [];
  const context = vm.createContext({
    clearTimeout, officialDomainAuditResumeTimer:null,
    officialDomainAuditRunning:false, officialDomainAuditStopRequested:false,
    officialDomainAuditWindow:null, officialDomainAuditAbortCurrent:null,
    store:{snapshot:()=>({settings:{brandCatalog:[]}})},
    ensureOfficialDomainRegistry:async()=>[], officialDomainAuditQueue:()=>[],
    createOfficialDomainAuditWindow:()=>({isDestroyed:()=>false,destroy:()=>{}}),
    persistOfficialDomainAudit:async()=>{},
    officialDomainRegistrySummary:()=>({pending:0,unchecked:0}),
    exportNaverOfficialStoreNotFoundExcel:async()=>{
      exportStarted();
      await exportPending;
      return {path:'report.xlsx',count:0};
    },
    sendOfficialDomainAuditProgress:(_registry,audit)=>progress.push(audit),
  });
  vm.runInContext(main.slice(start,end), context);
  const run = context.runOfficialDomainAudit();
  await exporting;
  assert.equal(context.officialDomainAuditRunning, true,
    'a stop request must not overwrite the still-finalizing run');
  finishExport();
  await run;
  assert.equal(context.officialDomainAuditRunning, false);
  assert.equal(progress.at(-1).state, 'completed');
});

test('stop returns a stopping snapshot without persisting stale progress', async () => {
  const main = (await readFile(new URL('../main.mjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = main.indexOf('  ipcMain.handle("official-domain:audit-stop"');
  const end = main.indexOf('\n  ipcMain.handle("weekly-site-health:status"', start);
  assert.ok(start > 0 && end > start);
  let stop;
  let writes = 0;
  const settingsWrites = [];
  let ticks = 0;
  const progress = [];
  const saved = { state: 'running', processed: 0, runTotal: 3400 };
  const context = vm.createContext({
    ipcMain:{handle:(_name,handler)=>{stop=handler;}},
    officialDomainAuditRunning:true, officialDomainAuditStopRequested:false,
    officialDomainAuditAutoPaused:false,
    officialDomainAuditLastProgress:{ processed:2, runTotal:3400, startedAt:'run-1' },
    officialDomainAuditAbortCurrent:null, officialDomainAuditWindow:null,
    officialDomainAuditResumeTimer:null, clearTimeout,
    mainWindow:{webContents:{send:(_channel,payload)=>progress.push(payload)}},
    Date:{now:()=>ticks++ * 1_000}, wait:async()=>{},
    store:{
      snapshot:()=>({settings:{brandCatalog:[]}}),
      setSettings:async(value)=>settingsWrites.push(value),
    },
    explorerMetadata:()=>({brands:[]}), ensureOfficialDomainRegistry:async()=>[],
    officialDomainAuditSnapshot:(_registry,overrides={})=>({...saved,...overrides}),
    persistOfficialDomainAudit:async()=>{writes++;},
  });
  vm.runInContext(main.slice(start,end), context);
  const result = await stop();
  assert.equal(result.audit.processed, 2);
  assert.equal(result.audit.phase, 'stopping');
  assert.equal(result.audit.running, true);
  assert.equal(progress[0].phase, 'stopping', 'stop must notify the screen before cleanup finishes');
  assert.equal(progress[0].autoPaused, true);
  assert.equal(context.officialDomainAuditAutoPaused, true);
  assert.equal(settingsWrites.length, 1);
  assert.equal(settingsWrites[0].officialDomainAuditAutoPaused, true);
  assert.equal(writes, 0);
  context.officialDomainAuditRunning = false;
  saved.state = 'paused';
  saved.processed = 2;
  const finished = await stop();
  assert.equal(finished.audit.processed, 2);
  assert.equal(finished.audit.state, 'paused');
  assert.equal(writes, 0);
});

test('automatic favorite checks stay paused until the user explicitly resumes', async () => {
  const main = (await readFile(new URL('../main.mjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = main.indexOf('  ipcMain.handle("official-domain:audit-start"');
  const end = main.indexOf('\n  ipcMain.handle("official-domain:audit-stop"', start);
  assert.ok(start > 0 && end > start);
  let startAudit;
  let runs = 0;
  const settingsWrites = [];
  const context = vm.createContext({
    ipcMain:{handle:(_name,handler)=>{startAudit=handler;}},
    officialDomainAuditAutoPaused:true, officialDomainAuditRunning:false,
    officialDomainAuditResumeTimer:null, clearTimeout,
    store:{
      snapshot:()=>({settings:{brandCatalog:[]}}),
      setSettings:async(value)=>settingsWrites.push(value),
    },
    explorerMetadata:()=>({brands:[]}), ensureOfficialDomainRegistry:async()=>[],
    officialDomainAuditSnapshot:()=>({autoPaused:context.officialDomainAuditAutoPaused}),
    runOfficialDomainAudit:async()=>{runs++;},
  });
  vm.runInContext(main.slice(start,end), context);
  const blocked = await startAudit(null, {brandIds:[100], automatic:true});
  assert.equal(blocked.paused, true);
  assert.equal(blocked.audit.autoPaused, true);
  assert.equal(runs, 0);
  assert.equal(settingsWrites.length, 0);

  const resumed = await startAudit(null, {recheckAll:true});
  assert.equal(resumed.ok, true);
  assert.equal(context.officialDomainAuditAutoPaused, false);
  assert.equal(runs, 1);
  assert.equal(settingsWrites.length, 1);
  assert.equal(settingsWrites[0].officialDomainAuditAutoPaused, false);
});
