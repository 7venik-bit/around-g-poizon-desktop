import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseLedgerAwareness,purchaseRowAvailable,purchasedRowsForArticle} from '../services/purchase-ledger-awareness.mjs';

const cell=(value='',type='text')=>({type,value});
function workbook() {
  const rows=Array.from({length:8},()=>Array.from({length:23},()=>cell()));
  rows[2][2]=cell('NV5VS03A');rows[2][6]=cell('BLACK · 105');rows[2][11]=cell('구매완료');rows[2][13]=cell('54487','number');
  rows[3][6]=cell('=IF(F4="","",F4)','formula');rows[3][11]=cell('구매완료');
  rows[5][0]=cell('입력 중인 브랜드');
  return {revision:'revision-1',local:{formulaOverrides:{}},sheets:[{
    id:1,name:'1-구매완료',rowCount:8,rawValues:rows,images:[{row:7,column:8}],
    notes:Array.from({length:8},()=>[]),merges:[],
  }]};
}

test('purchase ledger awareness identifies bought articles and safe empty row ranges',()=>{
  const book=workbook(),result=purchaseLedgerAwareness(book);
  assert.equal(result.purchasedCount,1);
  assert.deepEqual(purchasedRowsForArticle(result,' nv5vs03a ').map(item=>item.row),[3]);
  assert.deepEqual(result.freeRanges,[{start:4,end:5},{start:8,end:8}]);
  assert.equal(result.freeRowCount,3);
  assert.equal(result.firstFreeRow,4);
});

test('partial values, notes, photos, merges and overrides never count as free purchase rows',()=>{
  const book=workbook(),sheet=book.sheets[0];
  assert.equal(purchaseRowAvailable(sheet,6),false);
  assert.equal(purchaseRowAvailable(sheet,7),false);
  sheet.notes[3][7]='receipt';assert.equal(purchaseRowAvailable(sheet,4),false);
  sheet.notes[3][7]='';sheet.merges.push({row:3,rows:1});assert.equal(purchaseRowAvailable(sheet,4),false);
  sheet.merges=[];assert.equal(purchaseRowAvailable(sheet,4,{'4:18':true}),false);
});

test('unknown and missing purchase workbook products are not guessed',()=>{
  const result=purchaseLedgerAwareness(workbook());
  assert.deepEqual(purchasedRowsForArticle(result,'NV5VS03'),[]);
  assert.deepEqual(purchasedRowsForArticle(result,''),[]);
  assert.throws(()=>purchaseLedgerAwareness({sheets:[]}),/WORKBOOK_PURCHASE_SHEET_MISSING/);
});
