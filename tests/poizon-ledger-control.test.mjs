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
