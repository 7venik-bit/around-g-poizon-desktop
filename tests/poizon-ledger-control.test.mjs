import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('purchase ledger POIZON button runs seller sync and displays verified records and reviews',async()=>{
  const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../src/ledger-workbook.js',import.meta.url),'utf8');
  const dom=new JSDOM(html,{runScripts:'outside-only'}),{window}=dom;
  let runs=0;
  window.aroundG={
    loadLedgerWorkbook:async()=>({ok:false,code:'WORKBOOK_NOT_IMPORTED'}),
    getPoizonLedgerSyncStatus:async()=>({state:'waiting',message:'포이즌 주문 확인 대기 중'}),
    syncPoizonLedgerSales:async()=>{
      runs++;
      return {ok:true,status:{state:'complete',message:'거래 성공 43건 확인 · 신규 장부 기록 2건 · 저장 검증 2건 · 확인 필요 1건',
        recorded:[{orderNumber:'21315202429263299'}],verified:2,review:[{orderNumber:'21315202429263300',reason:'구매 행이 여러 개입니다'}]}};
    },
  };
  window.eval(script);
  const button=window.document.querySelector('#poizon-ledger-record #workbook-poizon-sync');
  assert.ok(button);
  assert.equal(window.document.querySelector('#purchase-ledger-form .panel-title p'),null);
  button.click();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(runs,1);
  assert.match(window.document.querySelector('#workbook-poizon-sync-status').textContent,/저장 검증 2건/);
  assert.equal(window.document.querySelector('#workbook-poizon-review-count').textContent,'1');
  assert.match(window.document.querySelector('#workbook-poizon-review-list').textContent,/구매 행이 여러 개입니다/);
  window.close();
});

test('a review item with differences shows them with an apply button',async()=>{
  const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../src/ledger-workbook.js',import.meta.url),'utf8');
  const dom=new JSDOM(html,{runScripts:'outside-only'}),{window}=dom;
  const item={orderNumber:'21315202429263300',reason:'기존 수수료와 주문 상세가 다릅니다',
    applicable:{purchaseRow:48,salesRow:3,diff:[{sheet:'1-구매완료',row:48,column:16,label:'수수료',before:'₩12,000',after:'₩7,500'}]}};
  let applied=null;
  window.aroundG={
    loadLedgerWorkbook:async()=>({ok:false,code:'WORKBOOK_NOT_IMPORTED'}),
    getPoizonLedgerSyncStatus:async()=>({state:'complete',message:'주문 확인 반영 대기',recorded:[],verified:0,review:[item]}),
    applyPoizonReviewSale:async(orderNumber)=>{applied=orderNumber;
      return {ok:true,status:{state:'complete',message:'주문 확인 반영 · 신규 장부 기록 1건 · 확인 필요 0건',recorded:[{orderNumber}],verified:1,review:[],updated:true}};},
  };
  window.eval(script);
  await new Promise(resolve=>setTimeout(resolve,20));
  const list=window.document.querySelector('#workbook-poizon-review-list');
  assert.match(list.textContent,/수수료.*₩12,000 → ₩7,500/);
  const button=list.querySelector('.poizon-review-apply');
  assert.ok(button);
  button.click();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(applied,'21315202429263300');
  assert.match(window.document.querySelector('#workbook-poizon-sync-status').textContent,/신규 장부 기록 1건/);
  window.close();
});

test('poizon order ledger sync status uses 확인 instead of 대조',async()=>{
  const main=await readFile(new URL('../main.mjs',import.meta.url),'utf8');
  assert.match(main,/건 확인 중 · 장부 기록/);
  assert.match(main,/건 확인 · 장부 기록/);
  assert.match(main,/건 확인 · 신규 장부 기록/);
  assert.doesNotMatch(main,/건 대조/);
});
