import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {normalizePurchaseLedgerRow,validatePurchaseLedgerRow} from '../services/purchase-ledger.mjs';
import {MusinsaLedgerCaptures} from '../services/musinsa-ledger-flow.mjs';

test('history relocation uses stored identity only, requires local committed history, and persists the new location',async()=>{
 const source=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
 const saved={id:'receipt',duplicateKey:'receipt',syncStatus:'synced',storage:'local',sheetRows:[575,576,577],
  brand:'TEST',articleNumber:'FIX001',modelName:'상품',krSize:'105',purchasePrice:163460,quantity:3,purchaseDate:'2026-09-17',
  orderNumber:'fixture-order',purchaseUrl:'https://www.musinsa.com/products/1',imageUrl:'https://image.msscdn.net/fixture.jpg',
  orderEvidence:{version:1,orderLineId:'line-1'}};
 let calls=0,history=saved;
 const context=createContext({normalizePurchaseLedgerRow,validatePurchaseLedgerRow,musinsaLedgerCaptures:new MusinsaLedgerCaptures(),runWeeklyLedgerBackup:async()=>{},
  store:{snapshot:()=>({ledger:[history]}),upsertCommitted:async(_name,row)=>{history=row;}},
  purchaseWorkbook:()=>({record:async(row,destination,options)=>{calls++;assert.equal(options.existingOnly,true);assert.equal(row.orderNumber,saved.orderNumber);assert.equal(row.purchasePrice,163460);assert.equal(row.orderEvidence.orderLineId,'line-1');assert.equal(destination.row,42);return {ok:true,moved:true,previousRowNumbers:[575,576,577],rowNumber:42,rowNumbers:[42,43,44],unitPrices:[54487,54487,54486],imageStatus:'existing'};}})});
 runInContext(source.slice(source.indexOf('async function syncPurchaseLedger('),source.indexOf('const SELLER_EXPORT_POLL_INTERVAL_MS')),context);
 const destination={sheetId:1,row:42,revision:'fixture'};
 assert.equal((await context.syncPurchaseLedger({moveId:'missing',destination})).code,'PURCHASE_EXISTING_NOT_FOUND');
 assert.equal((await context.syncPurchaseLedger({moveId:'receipt'})).code,'PURCHASE_DESTINATION_REQUIRED');
 assert.equal((await context.syncPurchaseLedger({...saved,destination})).code,'ORDER_CAPTURE_REQUIRED');
 for(const change of [{storage:'google'},{syncStatus:'failed'}]){history={...saved,...change};assert.equal((await context.syncPurchaseLedger({moveId:'receipt',destination})).code,'PURCHASE_EXISTING_NOT_FOUND');}
 assert.equal(calls,0);history=saved;
 const result=await context.syncPurchaseLedger({moveId:'receipt',destination,orderNumber:'tampered',purchasePrice:1,quantity:1,orderEvidence:{orderLineId:'wrong'}});
 assert.equal(result.moved,true);assert.equal(calls,1);assert.equal(history.id,'receipt');assert.deepEqual(history.sheetRows,[42,43,44]);assert.equal(history.purchasePrice,163460);
});
