import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../services/google-ledger-apps-script.gs',import.meta.url),'utf8');
const revision='2026-09-21T00:00:00.000Z';
function server(options={}) {
 let value=options.initial ?? 62330, formula=options.formula || '',writes=0;
 const cell={getValue:()=>value,getFormula:()=>formula,canEdit:()=>options.editable!==false,isPartOfMerge:()=>false,getDataValidation:()=>options.validation || null,
 setValue:v=>{value=v;formula='';writes++;},setFormula:v=>{formula=v;writes++;},setRichTextValue:v=>{value=v;formula='';writes++;},clearContent:()=>{value='';formula='';writes++;}};
 const sheet={getSheetId:()=>1,getMaxRows:()=>1000,getMaxColumns:()=>30,getRange:(r,c)=>{assert.equal(r,5);assert.equal(c,14);return cell;}};
 const context={DriveApp:{getFileById:()=>({getLastUpdated:()=>new Date(options.revision || revision)})},SpreadsheetApp:{openById:()=>({getSheets:()=>[sheet],getSpreadsheetTimeZone:()=> 'Asia/Seoul'}),flush(){},DataValidationCriteria:{VALUE_IN_LIST:'list',VALUE_IN_RANGE:'range',CHECKBOX:'check'},newRichTextValue:()=>({setText:v=>({build:()=>v})})}};
 vm.createContext(context);vm.runInContext(source,context);
 context.readOriginalWorkbook_=()=>{if(options.refreshFail)throw Error('network');return {sheets:[{name:'구매완료'}],value,formula};};
 return {edit:change=>context.editWorkbookCell_({sheetId:1,row:5,column:14,revision,expected:{type:options.formula?'formula':typeof value==='number'?'number':'text',value:options.formula || String(options.initial ?? 62330)},next:{type:'number',value:'65000'},...change}),state:()=>({value,formula,writes})};
}
test('numeric cell edit writes only addressed cell, verifies result and obtains refreshed workbook',()=>{
 const s=server();const r=s.edit();assert.equal(r.ok,true);assert.equal(r.workbook.value,65000);assert.deepEqual(s.state(),{value:65000,formula:'',writes:1});
});
test('stale revision or cell value never overwrites existing money',()=>{
 for(const change of [{revision:'old'},{expected:{type:'number',value:'1'}}]){const s=server();assert.equal(s.edit(change).code,'CELL_CONFLICT');assert.equal(s.state().writes,0);}
});
test('shipping labels, malformed numbers, excessive precision and nonfinite input cannot become money',()=>{
 for(const value of ['62,330원 배송비 3,000원','62330원','1.2345678901234567','9007199254740993','NaN','Infinity','1e9','01']){const s=server();assert.equal(s.edit({next:{type:'number',value}}).code,'CELL_NUMBER_INVALID',value);assert.equal(s.state().writes,0);}
});
test('literal leading equals and leading zero stay text, formulas require explicit formula type',()=>{
 const literal=server({initial:'00123'});assert.equal(literal.edit({next:{type:'text',value:'=1+2'}}).ok,true);assert.deepEqual(literal.state(),{value:'=1+2',formula:'',writes:1});
 const formula=server({formula:'=SUM(A1:A2)'});assert.equal(formula.edit({next:{type:'formula',value:'=SUM(A1:A3)'}}).ok,true);assert.equal(formula.state().formula,'=SUM(A1:A3)');
});
test('protected and dropdown-restricted cells reject invalid writes',()=>{
 const protectedCell=server({editable:false});assert.equal(protectedCell.edit().code,'CELL_PROTECTED');assert.equal(protectedCell.state().writes,0);
 const restricted=server({initial:'구매완료',validation:{getCriteriaType:()=> 'list',getCriteriaValues:()=>[['구매완료','반품완료']]}});
 assert.equal(restricted.edit({next:{type:'text',value:'임의상태'}}).code,'CELL_VALIDATION_FAILED');assert.equal(restricted.state().writes,0);
 assert.equal(restricted.edit({next:{type:'text',value:'반품완료'}}).ok,true);
});
test('remote save followed by refresh failure is never advertised as complete',()=>{
 const s=server({refreshFail:true});const r=s.edit();assert.equal(r.ok,false);assert.equal(r.written,true);assert.equal(r.code,'CELL_SAVED_REFRESH_REQUIRED');assert.equal(s.state().writes,1);
});
test('editor sends selected coordinate and untouched expected value, then renders confirmed server value',async()=>{
 const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');const script=await readFile(new URL('../src/ledger-workbook.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only'});const book={title:'장부',revision,capturedAt:revision,sheets:[{id:1,name:'구매완료',displayValues:[['₩62,330']],formulas:[['']],rawValues:[[{type:'number',value:'62330'}]]}]};let sent;
 dom.window.aroundG={loadLedgerWorkbook:async()=>({ok:true,workbook:book}),editLedgerWorkbookCell:async edit=>{sent=JSON.parse(JSON.stringify(edit));const next=structuredClone(book);next.sheets[0].displayValues=[['₩65,000']];next.sheets[0].rawValues=[[{type:'number',value:'65000'}]];return {ok:true,workbook:next};}};
 dom.window.eval(script);await new Promise(r=>setTimeout(r,20));const d=dom.window.document;d.querySelector('#workbook-table td').click();
 assert.equal(d.getElementById('workbook-cell-value').value,'62330');assert.equal(d.getElementById('workbook-cell-type').value,'number');
 d.getElementById('workbook-cell-value').value='65000';d.getElementById('workbook-cell-editor').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 await new Promise(r=>setTimeout(r,20));assert.deepEqual(sent,{sheetId:1,row:1,column:1,revision,expected:{type:'number',value:'62330'},next:{type:'number',value:'65000'}});
 assert.equal(d.querySelector('#workbook-table td').textContent,'₩65,000');assert.equal(d.getElementById('workbook-export').disabled,false);dom.window.close();
});
test('unconfirmed write disables stale export and further edits in the UI',async()=>{
 const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');const script=await readFile(new URL('../src/ledger-workbook.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only'});const book={title:'장부',revision,capturedAt:revision,sheets:[{id:1,name:'구매완료',displayValues:[['1']],formulas:[['']],rawValues:[[{type:'number',value:'1'}]]}]};
 dom.window.aroundG={loadLedgerWorkbook:async()=>({ok:true,workbook:book}),editLedgerWorkbookCell:async()=>({ok:false,code:'CELL_SAVED_REFRESH_REQUIRED'})};dom.window.eval(script);await new Promise(r=>setTimeout(r,20));const d=dom.window.document;d.querySelector('#workbook-table td').click();d.getElementById('workbook-cell-value').value='2';d.getElementById('workbook-cell-editor').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,20));assert.equal(d.getElementById('workbook-export').disabled,true);assert.equal(d.getElementById('workbook-cell-save').disabled,true);dom.window.close();
});

test('unconfirmed remote write leaves persistent marker and blocks export after restart',async()=>{
 const fs=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const main=await readFile(new URL('../main.mjs',import.meta.url),'utf8');const start=main.indexOf('  const ledgerWorkbookPath ='),end=main.indexOf('  ipcMain.handle("explorer:meta"',start);
 const dir=await fs.mkdtemp(join(tmpdir(),'ledger-edit-'));let dialogs=0;
 function boot(){const handlers=new Map();const ctx={join,app:{getPath:()=>dir},stat:fs.stat,writeFile:fs.writeFile,unlink:fs.unlink,readLedgerWorkbook:async()=>({title:'cached'}),workbookView:v=>v,safeStorage:{isEncryptionAvailable:()=>true,decryptString:x=>x},store:{snapshot:()=>({settings:{ledgerWebhookUrl:'https://script.google.com/macros/s/test/exec',ledgerSecretEncrypted:'test'}})},decrypted:()=> 'test',AbortSignal,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showSaveDialog:async()=>{dialogs++;return {canceled:true};}},fetch:async(url,options={})=>({ok:true,json:async()=>options.method==='POST'?{ok:false,code:'CELL_SAVED_REFRESH_REQUIRED'}:{capabilities:['workbook.edit.v1']}})};vm.createContext(ctx);vm.runInContext(main.slice(start,end),ctx);return handlers;}
 try{let h=boot();assert.equal((await h.get('ledger:workbook-edit')(null,{})).code,'CELL_SAVED_REFRESH_REQUIRED');
 h=boot();assert.equal((await h.get('ledger:workbook-load')()).needsRefresh,true);assert.equal((await h.get('ledger:workbook-export')()).code,'WORKBOOK_REFRESH_REQUIRED');assert.equal(dialogs,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
