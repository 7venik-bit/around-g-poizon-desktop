import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPoizonPageCheckpoint } from '../services/poizon-page-checkpoint.mjs';

function memoryFs(initial = Buffer.from('A')) {
  let current = Buffer.from(initial), backup = null, reads = 0, writes = 0, copies = 0;
  return {
    api: {
      readFile: async () => { reads++; return Buffer.from(current); },
      writeFile: async (_path, value) => { current = Buffer.from(value); writes++; },
      copyFile: async () => { backup = Buffer.from(current); copies++; },
    },
    state: () => ({ current: current.toString(), backup: backup?.toString() || '', reads, writes, copies }),
  };
}

test('one page is written, reread, and verified before continuation', async () => {
  const fs = memoryFs(); let calls = 0;
  const applyWorkbook = (buffer) => {
    calls++;
    if (buffer.toString() === 'A') return { ok:true, changed:true, reverified:true, changedRows:2, changedCells:3, addedRows:1, addedProducts:1, verifiedCells:4, changes:[{ reason:'MISSING_PRODUCT_ROW', spuId:'2' }], buffer:Buffer.from('B') };
    return { ok:true, changed:false, reverified:true, changedRows:0, changedCells:0, addedRows:0, addedProducts:0, verifiedCells:4, changes:[], buffer:Buffer.from('B') };
  };
  const result = await syncPoizonPageCheckpoint({ filePath:'A.xlsx', products:[{spuId:'2'}], pageNum:1, fs:fs.api, applyWorkbook });
  assert.equal(result.ok, true);
  assert.equal(result.reverified, true);
  assert.equal(result.changedRows, 2);
  assert.equal(result.addedRows, 1);
  assert.equal(fs.state().current, 'B');
  assert.equal(fs.state().backup, 'A');
  assert.equal(fs.state().writes, 1);
  assert.equal(fs.state().copies, 1);
  assert.equal(calls, 2);
});

test('existing backup is reused so every page does not create another backup file', async () => {
  const fs = memoryFs(Buffer.from('B'));
  const applyWorkbook = () => ({ ok:true, changed:false, reverified:true, changedRows:0, changedCells:0, addedRows:0, addedProducts:0, verifiedCells:2, changes:[], buffer:Buffer.from('B') });
  const result = await syncPoizonPageCheckpoint({ filePath:'A.xlsx', products:[{spuId:'2'}], pageNum:2, backupPath:'first-page.bak', fs:fs.api, applyWorkbook });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'PAGE_CHECKPOINT_NO_CHANGES');
  assert.equal(result.backupPath, 'first-page.bak');
  assert.equal(fs.state().reads, 1);
  assert.equal(fs.state().copies, 0);
  assert.equal(fs.state().writes, 0);
});

test('an unchanged page proceeds without disk write or reread', async () => {
  const fs = memoryFs(Buffer.from('already-current')); let calls = 0;
  const result = await syncPoizonPageCheckpoint({
    filePath:'A.xlsx', products:[{spuId:'2'}], pageNum:4, fs:fs.api,
    applyWorkbook:() => { calls++; return {ok:true,changed:false,reverified:true,verifiedCells:2,changes:[],buffer:Buffer.from('already-current')}; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'PAGE_CHECKPOINT_NO_CHANGES');
  assert.equal(result.reverified, true);
  assert.equal(calls, 1);
  assert.deepEqual([fs.state().reads, fs.state().copies, fs.state().writes], [1, 0, 0]);
});

test('a disk reread that still requires changes blocks the next page', async () => {
  const fs = memoryFs();
  const applyWorkbook = () => ({ ok:true, changed:true, reverified:true, changedRows:1, changedCells:1, addedRows:0, addedProducts:0, verifiedCells:1, changes:[], buffer:Buffer.from('B') });
  const result = await syncPoizonPageCheckpoint({ filePath:'A.xlsx', products:[{spuId:'2'}], pageNum:3, fs:fs.api, applyWorkbook });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PAGE_CHECKPOINT_REREAD_MISMATCH');
  assert.match(result.message, /다음 페이지로 이동하지 않습니다/);
});


test('backup failure aborts before touching the original workbook', async () => {
  let writes=0;
  const original=Buffer.from('untouched original workbook');
  const result=await syncPoizonPageCheckpoint({filePath:'A.xlsx',products:[{spuId:'1'}],fs:{
    readFile:async()=>Buffer.from(original),
    copyFile:async()=>{throw new Error('backup disk unavailable');},
    writeFile:async()=>{writes++;},
  },applyWorkbook:()=>({ok:true,reverified:true,changed:true,buffer:Buffer.from('corrected')})});
  assert.equal(result.ok,false);
  assert.match(result.message,/backup disk unavailable/);
  assert.equal(writes,0);
});

test('unverified workbook transformation cannot create a backup or write the original', async () => {
  let writes=0,copies=0;
  const result=await syncPoizonPageCheckpoint({filePath:'A.xlsx',products:[{spuId:'1'}],fs:{
    readFile:async()=>Buffer.from('original'),copyFile:async()=>{copies++;},writeFile:async()=>{writes++;},
  },applyWorkbook:()=>({ok:true,reverified:false,changed:true,buffer:Buffer.from('unsafe')})});
  assert.equal(result.ok,false);
  assert.deepEqual([copies,writes],[0,0]);
});
