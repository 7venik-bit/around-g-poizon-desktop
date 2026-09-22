import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import fixture from './fixtures/ledger-layout-data.cjs';

const html=readFileSync(new URL('../src/index.html',import.meta.url),'utf8');
const viewer=readFileSync(new URL('../src/ledger-workbook.js',import.meta.url),'utf8');
const renderer=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');
const purchaseCode=renderer.slice(renderer.indexOf('let capturedLedgerRows = [];'),renderer.indexOf('function openEntry(collection)'));
const historyCode=renderer.slice(renderer.indexOf('function renderLedgerRecords()'),renderer.indexOf('function stockWatchTime('));
const flush=()=>new Promise(resolve=>setTimeout(resolve,20));

function book(recorded=true) {
  const value=fixture.ledgerLayoutBook(20),sheet=value.sheets[0];
  for(const key of ['displayValues','formulas','rawValues','notes','backgrounds','fontColors','fontWeights'])sheet[key]=sheet[key].slice(0,2);
  sheet.rowCount=1002;
  for(let r=2;r<600;r++) {
    const display=Array(20).fill('');
    if(recorded && r>=574 && r<=576) {display[0]='테스트';display[2]='FIXTURE-575';display[3]='기록 확인용 상품';display[13]='₩10,000';}
    sheet.displayValues.push(display);sheet.formulas.push(Array(20).fill(''));
    sheet.rawValues.push(display.map(value=>({type:'text',value})));
  }
  if(recorded)for(let r=574;r<=576;r++)sheet.formulas[r][7]='=IMAGE("https://images.example.test/record.jpg",1)';
  return value;
}
async function boot(t,{initial=book(false),fresh=book(),importer}={}) {
  const dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,d=w.document,calls={reads:0,writes:0,scrolls:[]};
  w.HTMLElement.prototype.scrollIntoView=function(){calls.scrolls.push(this.id);};
  let initialized=false;
  w.aroundG={loadLedgerWorkbook:async()=>{if(!initialized){initialized=true;return {ok:true,workbook:initial};}calls.reads++;return importer?importer():{ok:true,workbook:fresh};},
    editLedgerWorkbookCell:async()=>{calls.writes++;return {ok:false};}};
  w.eval(viewer);await flush();return {w,d,calls};
}

test('record location refreshes the committed local workbook, opens page 501-600 and highlights all three units with their photos',async t=>{
  const fresh=book(),before=structuredClone(fresh),{w,d,calls}=await boot(t,{fresh});
  d.querySelector('#workbook-hidden').checked=true;d.querySelector('#workbook-hidden').dispatchEvent(new w.Event('change'));
  d.querySelectorAll('#workbook-tabs button')[1].click();
  assert.equal(d.querySelector('#workbook-table table').getAttribute('aria-label'),'숨김 예시');
  d.querySelectorAll('#workbook-tabs button')[0].click();
  assert.match(d.querySelector('#workbook-page').textContent,/1–100/);
  const result=await w.aroundGLedgerWorkbook.showRecordedRows([577,575,576,575]);
  assert.equal(result.ok,true);assert.equal(calls.reads,1);assert.equal(calls.writes,0);
  assert.match(d.querySelector('#workbook-page').textContent,/501–600/);
  assert.deepEqual([...d.querySelectorAll('.workbook-recorded-row')].map(r=>r.dataset.rowNumber),['575','576','577']);
  const row=d.querySelector('[data-row-number="575"]');
  assert.equal(row.children[3].textContent,'FIXTURE-575');
  assert.equal(row.querySelector('img').src,'https://images.example.test/record.jpg');
  assert.deepEqual(calls.scrolls,['original-ledger-workbook']);
  assert.equal(d.querySelector('#workbook-cell-editor').hidden,true);
  assert.match(d.querySelector('#workbook-status').textContent,/575, 576, 577행/);
  assert.deepEqual(fresh,before);
});

test('cross-page recorded units keep original row numbers and remain highlighted when paging',async t=>{
  const {w,d}=await boot(t);
  await w.aroundGLedgerWorkbook.showRecordedRows([100,101]);
  assert.match(d.querySelector('#workbook-page').textContent,/1–100/);
  assert.deepEqual([...d.querySelectorAll('.workbook-recorded-row')].map(r=>r.dataset.rowNumber),['100']);
  d.querySelector('#workbook-next').click();
  assert.deepEqual([...d.querySelectorAll('.workbook-recorded-row')].map(r=>r.dataset.rowNumber),['101']);
});

test('refresh failure preserves the cached view, blocks stale exports and never writes a purchase',async t=>{
  const {w,d,calls}=await boot(t,{importer:()=>({ok:false,code:'OFFLINE'})});
  const result=await w.aroundGLedgerWorkbook.showRecordedRows([575]);
  assert.equal(result.ok,false);assert.equal(result.code,'OFFLINE');assert.equal(calls.writes,0);
  assert.match(d.querySelector('#workbook-page').textContent,/1–100/);
  assert.equal(d.querySelector('.workbook-recorded-row'),null);
  assert.equal(d.querySelector('#workbook-export').disabled,true);
  assert.match(d.querySelector('#workbook-status').textContent,/새로 불러오지 못했습니다/);
});

test('location navigation preserves an open cell edit and rejects missing sheet/row destinations',async t=>{
  const {w,d,calls}=await boot(t);
  d.querySelector('#workbook-table td').click();d.querySelector('#workbook-cell-value').value='저장 전 편집';
  assert.equal((await w.aroundGLedgerWorkbook.showRecordedRows([575])).code,'WORKBOOK_EDIT_PENDING');
  assert.equal(d.querySelector('#workbook-cell-value').value,'저장 전 편집');assert.equal(calls.reads,0);
  d.querySelector('#workbook-cell-cancel').click();
  assert.equal((await w.aroundGLedgerWorkbook.showRecordedRows([9999])).code,'WORKBOOK_RECORD_LOCATION_MISSING');
  assert.equal(d.querySelector('.workbook-recorded-row'),null);
  const other=book();other.sheets[0].name='다른 시트';w.aroundG.loadLedgerWorkbook=async()=>({ok:true,workbook:other});
  assert.equal((await w.aroundGLedgerWorkbook.showRecordedRows([575])).code,'WORKBOOK_RECORD_LOCATION_MISSING');
  assert.equal(calls.writes,0);
});

test('record history opens legacy and multi-unit records with a fresh read and no resubmission',async t=>{
  const {w,d,calls}=await boot(t);
  w.$=selector=>d.querySelector(selector);w.text=value=>String(value??'').replace(/[&<>"']/g,'');
  w.state={ledger:[{id:'legacy',modelName:'한 행 기록',sheetRow:575,syncStatus:'synced'},
    {id:'units',modelName:'여러 행 기록',sheetRows:[575,576,577],syncStatus:'duplicate'},
    {id:'failed',modelName:'실패 기록',syncStatus:'failed'}]};
  w.eval(purchaseCode+'\n'+historyCode+'\nrenderLedgerRecords();');
  assert.equal(d.querySelectorAll('[data-ledger-view]').length,2);
  assert.ok(d.querySelector('[data-ledger-retry="failed"]'));
  d.querySelector('[data-ledger-view="legacy"]').click();await flush();
  assert.equal(d.querySelectorAll('.workbook-recorded-row').length,1);
  d.querySelector('[data-ledger-view="units"]').click();await flush();
  assert.equal(d.querySelectorAll('.workbook-recorded-row').length,3);
  assert.equal(calls.reads,2);assert.equal(calls.writes,0);
  assert.match(d.querySelector('#ledger-status').textContent,/575, 576, 577행을 표시/);
});

test('a successful or duplicate purchase automatically refreshes the original table without a second write',async t=>{
  for(const duplicate of [false,true]) {
    const {w,d,calls}=await boot(t);let writes=0;
    w.$=selector=>d.querySelector(selector);w.text=value=>String(value??'').replace(/[&<>"']/g,'');w.refresh=async()=>{};
    const row={captureId:'fixture',brand:'테스트',articleNumber:'FIXTURE-575',modelName:'기록 확인용 상품',krSize:'270',quantity:3,purchasePrice:30000,purchaseDate:'2026-09-22',orderNumber:'FIXTURE-ORDER',purchaseUrl:'https://www.musinsa.com/products/10001',imageUrl:'https://images.example.test/record.jpg'};
    w.aroundG.captureMusinsaLedger=async()=>({ok:true,rows:[row]});
    w.aroundG.syncPurchaseLedger=async input=>{writes++;assert.equal(input.destination.row,42);assert.equal(input.destination.sheetId,1);return {ok:true,duplicate,rowNumbers:[575,576,577],imageStatus:'formula'};};
    w.eval(purchaseCode);d.querySelector('#ledger-capture').click();await flush();
    d.querySelector('td[data-row="42"][data-column="1"]').click();
    d.querySelector('#purchase-ledger-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
    assert.equal(writes,1);assert.equal(calls.reads,1);assert.equal(calls.writes,0);
    assert.match(d.querySelector('#workbook-page').textContent,/501–600/);
    assert.equal(d.querySelectorAll('.workbook-recorded-row').length,3);
    assert.equal(d.querySelector('#ledger-submit').disabled,true);
    assert.match(d.querySelector('#ledger-status').textContent,duplicate?/기존 575, 576, 577행/:/575, 576, 577행에 기록/);
  }
});

test('purchase destination follows the clicked row, requires one data row and protects dirty edits',async t=>{
  const {w,d}=await boot(t),api=w.aroundGLedgerWorkbook;
  assert.equal(api.getPurchaseDestination().code,'PURCHASE_DESTINATION_REQUIRED');
  const cell=(row,column=1)=>d.querySelector(`td[data-row="${row}"][data-column="${column}"]`);
  cell(2).click();assert.equal(api.getPurchaseDestination().code,'PURCHASE_DESTINATION_INVALID');
  cell(42,8).click();assert.equal(api.getPurchaseDestination().destination.row,42);assert.match(d.querySelector('#ledger-destination').textContent,/42행/);
  d.querySelector('#workbook-cell-value').value='unsaved';assert.equal(api.beginPurchaseRecord().code,'WORKBOOK_EDIT_PENDING');
  d.querySelector('#workbook-cell-value').value='';
  const placement=api.beginPurchaseRecord();assert.equal(placement.destination.row,42);
  cell(43).click();assert.equal(api.getPurchaseDestination().code,'WORKBOOK_BUSY');
  assert.equal(d.querySelector('#workbook-import').disabled,true);assert.equal(d.querySelector('#workbook-cell-value').disabled,true);
  api.endPurchaseRecord(false);assert.equal(api.getPurchaseDestination().destination.row,42);
  cell(43).dispatchEvent(new w.MouseEvent('click',{bubbles:true,shiftKey:true}));assert.equal(api.getPurchaseDestination().code,'PURCHASE_DESTINATION_INVALID');
  cell(42).click();api.beginPurchaseRecord();api.endPurchaseRecord(true);assert.equal(api.getPurchaseDestination().code,'PURCHASE_DESTINATION_REQUIRED');
  cell(42).click();d.querySelector('#workbook-next').click();assert.equal(api.getPurchaseDestination().code,'PURCHASE_DESTINATION_REQUIRED');
});

test('a failed selected-row write unlocks the same destination without marking the captured order recorded',async t=>{
  const {w,d}=await boot(t);w.$=selector=>d.querySelector(selector);w.text=value=>String(value??'');w.refresh=async()=>{};
  const row={captureId:'fixture',brand:'TEST',articleNumber:'AB123',modelName:'fixture product',krSize:'270',quantity:1,purchasePrice:10000,purchaseDate:'2026-09-22',orderNumber:'fixture-order',purchaseUrl:'https://www.musinsa.com/products/1',imageUrl:'https://images.example.test/p.jpg'};
  w.aroundG.captureMusinsaLedger=async()=>({ok:true,rows:[row]});let writes=0;
  w.aroundG.syncPurchaseLedger=async input=>{writes++;assert.equal(input.destination.row,42);return {ok:false,code:'PURCHASE_DESTINATION_OCCUPIED'};};
  w.eval(purchaseCode);d.querySelector('#ledger-capture').click();await flush();
  assert.equal(d.querySelector('#ledger-submit').disabled,true);
  d.querySelector('#purchase-ledger-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();assert.equal(writes,0);
  d.querySelector('td[data-row="42"][data-column="1"]').click();assert.equal(d.querySelector('#ledger-submit').disabled,false);
  d.querySelector('#purchase-ledger-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
  assert.equal(writes,1);assert.equal(w.aroundGLedgerWorkbook.getPurchaseDestination().destination.row,42);
  assert.equal(d.querySelector('#ledger-submit').disabled,false);assert.match(d.querySelector('#ledger-status').textContent,/기존 상품/);
});
