import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { zipSync, strToU8 } from 'fflate';
import { LEDGER_SPREADSHEET_ID, validateLedgerWorkbook, saveLedgerWorkbook, readLedgerWorkbook, exportLedgerWorkbook, workbookView } from '../services/ledger-workbook.mjs';
const bytes=Buffer.from(zipSync({'xl/workbook.xml':strToU8('<workbook/>')}));
const checksum=createHash('sha256').update(bytes).digest('hex');
function fixture(){return {schemaVersion:1,spreadsheetId:LEDGER_SPREADSHEET_ID,title:'원본',capturedAt:'2026-09-21',xlsxBase64:bytes.toString('base64'),xlsxSha256:checksum,sheets:[{id:1,name:'1-구매완료',hidden:false,displayValues:[['품번','구매가'],[' 001-ABC ','₩62,330'],[' 001-ABC ','#VALUE!']],formulas:[['',''],['',''],['','=1+" "']]},{id:2,name:'사이즈',hidden:true,displayValues:[['001']],formulas:[['']]}]};}
test('all cells, duplicate rows, formulas and hidden tabs survive encrypted save and exact-byte export',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ledger-'));try{
 const input=fixture(), path=join(dir,'cache'), original=JSON.stringify(input);
 await saveLedgerWorkbook(path,input,s=>Buffer.from(s).map(b=>b^85));
 const reread=await readLedgerWorkbook(path,b=>Buffer.from(b).map(v=>v^85).toString());
 assert.equal(JSON.stringify(reread),original);assert.equal(JSON.stringify(input),original);
 await exportLedgerWorkbook(join(dir,'export.xlsx'),reread);
 assert.deepEqual(await readFile(join(dir,'export.xlsx')),bytes);
 assert.equal(workbookView(reread).xlsxBase64,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('invalid import preserves prior cache and invalid export leaves existing file intact',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ledger-'));try{
 const path=join(dir,'existing');await writeFile(path,'unchanged');const bad=fixture();bad.xlsxSha256='wrong';
 await assert.rejects(saveLedgerWorkbook(path,bad,Buffer.from),/CHECKSUM/);
 await assert.rejects(exportLedgerWorkbook(path,bad),/CHECKSUM/);
 assert.equal(await readFile(path,'utf8'),'unchanged');
 const malformed=fixture();malformed.sheets[0].displayValues[0][0]=123;
 assert.throws(()=>validateLedgerWorkbook(malformed),/WORKBOOK_INVALID/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('read-only bridge returns every sheet without calling any sheet mutator',async()=>{
 const source=await readFile(new URL('../services/google-ledger-apps-script.gs',import.meta.url),'utf8');
 const sheet={getSheetId:()=>1,getName:()=> '1-구매완료',isSheetHidden:()=>false,getMaxRows:()=>1000,getMaxColumns:()=>30,getFrozenRows:()=>2,getFrozenColumns:()=>0,getDataRange:()=>({getDataValidations:()=>[[null,null]],getValues:()=>[['001','#VALUE!']],getDisplayValues:()=>[['001','#VALUE!']],getFormulas:()=>[['','=1+" "']],getBackgrounds:()=>[],getFontColors:()=>[],getFontWeights:()=>[],getNumberFormats:()=>[],getNotes:()=>[],getMergedRanges:()=>[]})};
 const context={LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test'})},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})},DriveApp:{getFileById:()=>({getLastUpdated:()=>new Date('2026-09-21')})},SpreadsheetApp:{openById:()=>({getSheets:()=>[sheet],getName:()=> '원본',getSpreadsheetTimeZone:()=> 'Asia/Seoul'})},UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContent:()=>[...bytes]})},ScriptApp:{getOAuthToken:()=> 'test'},Utilities:{DigestAlgorithm:{SHA_256:1},computeDigest:()=>[...Buffer.from(checksum,'hex')],base64Encode:()=>bytes.toString('base64')}};
 vm.createContext(context);vm.runInContext(source,context);
 const result=context.doPost({postData:{contents:JSON.stringify({secret:'test',action:'workbook.read'})}});
 assert.equal(result.ok,true);assert.equal(result.workbook.sheets[0].displayValues[0][1],'#VALUE!');validateLedgerWorkbook(result.workbook);
 let calls=0;context.DriveApp.getFileById=()=>({getLastUpdated:()=>new Date(++calls===1?'2026-09-21':'2026-09-22')});
 const changed=context.doPost({postData:{contents:JSON.stringify({secret:'test',action:'workbook.read'})}});
 assert.equal(changed.ok,false);assert.match(changed.message,/CHANGED_DURING_READ/);
});
test('renderer preserves tab order, hidden tabs, literal cell text and all paged rows',async()=>{
 const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
 const source=await readFile(new URL('../src/ledger-workbook.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only'});const book=workbookView(fixture());
 book.sheets[0].displayValues=Array.from({length:102},(_,i)=>[String(i),i===0?'<script>oops</script>':'₩62,330']);book.sheets[0].formulas=book.sheets[0].displayValues.map(()=>['','']);
 dom.window.aroundG={loadLedgerWorkbook:async()=>({ok:true,workbook:book})};dom.window.eval(source);
 await new Promise(r=>setTimeout(r,20));const d=dom.window.document;
 assert.equal(d.querySelectorAll('#workbook-tabs button').length,1);assert.equal(d.querySelector('#workbook-table td').textContent,'0');
 assert.equal(d.querySelector('#workbook-table script'),null);d.getElementById('workbook-next').click();
 assert.equal(d.querySelector('#workbook-table td').textContent,'100');
 d.getElementById('workbook-hidden').checked=true;d.getElementById('workbook-hidden').dispatchEvent(new dom.window.Event('change'));
 assert.deepEqual([...d.querySelectorAll('#workbook-tabs button')].map(x=>x.textContent),['1-구매완료','사이즈 (숨김)']);dom.window.close();
});

test('desktop refuses old bridge before sending any POST that could mutate the sheet',async()=>{
 const main=await readFile(new URL('../main.mjs',import.meta.url),'utf8');
 const start=main.indexOf('  const ledgerWorkbookPath =');
 const end=main.indexOf('  ipcMain.handle("explorer:meta"',start);
 const handlers=new Map(), calls=[];
 const context={join,app:{getPath:()=>'/tmp'},readLedgerWorkbook,safeStorage:{isEncryptionAvailable:()=>true},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},store:{snapshot:()=>({settings:{ledgerWebhookUrl:'https://script.google.com/macros/s/example/exec',ledgerSecretEncrypted:'test'}})},decrypted:()=> 'test',AbortSignal,fetch:async(url,options={})=>{calls.push(options.method || 'GET');return {ok:true,json:async()=>({ok:true,service:'old bridge'})}}};
 vm.createContext(context);vm.runInContext(main.slice(start,end),context);
 const result=await handlers.get('ledger:workbook-import')();
 assert.equal(result.ok,false);assert.equal(result.code,'WORKBOOK_BRIDGE_UPDATE_REQUIRED');assert.deepEqual(calls,['GET']);
});
