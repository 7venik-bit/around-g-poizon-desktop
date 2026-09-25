import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePoizonOrders,verifyPoizonRecordedSales} from '../services/poizon-order-ledger.mjs';

const blank=()=>({type:'text',value:''});
function sheet(id,name) {
  const rows=Array.from({length:5},()=>Array.from({length:23},blank));
  const put=(row,column,type,value)=>{rows[row-1][column-1]={type,value:String(value)};};
  if(name==='1-구매완료') {
    put(5,1,'text','데상트');put(5,3,'text','SR123UPS11');put(5,4,'text','남녀공용 카라 셔츠 블랙');
    put(5,6,'text','95');put(5,8,'formula','=IMAGE("https://example.com/shirt.png",1)');
    put(5,12,'text','구매완료');put(5,14,'number',50000);
    put(5,18,'formula','=IF(J5="","",J5-N5-P5-Q5)');
  }
  return {id,name,rowCount:1000,columnCount:23,rawValues:rows,
    displayValues:rows.map(row=>row.map(cell=>cell.type==='formula'?'':cell.value)),
    formulas:rows.map(row=>row.map(cell=>cell.type==='formula'?cell.value:'')),
    notes:rows.map(row=>row.map(()=>'')),numberFormats:rows.map(row=>row.map(()=> 'General')),
    backgrounds:rows.map(row=>row.map(()=>'')),fontColors:rows.map(row=>row.map(()=>'')),fontWeights:rows.map(row=>row.map(()=>'')),validations:rows.map(row=>row.map(()=>null)),images:[]};
}
const book=()=>({sheets:[sheet(1,'1-구매완료'),sheet(2,'5-판매완료')],local:{}});
const order=()=>({orderNumber:'21315202429263299',status:'거래 성공',route:'일반판매',quantity:1,
  articleNumber:'SR123UPS11',size:'SIZE 95',saleDate:'2026-09-16',salePrice:75000,income:60000});

test('verified POIZON sale fills purchase and sales tabs once with actual fee and shifted formulas',()=>{
  const workbook=book(),first=reconcilePoizonOrders(workbook,[order()]);
  assert.equal(first.review.length,0);assert.equal(first.recorded.length,1);
  const purchase=workbook.sheets[0],sales=workbook.sheets[1],saleRow=first.recorded[0].salesRow;
  assert.equal(purchase.rawValues[4][9].value,'75000');assert.equal(purchase.rawValues[4][15].value,'15000');
  assert.equal(sales.rawValues[saleRow-1][11].value,'일판완료');
  assert.equal(sales.rawValues[saleRow-1][9].value,'75000');assert.equal(sales.rawValues[saleRow-1][15].value,'15000');
  assert.equal(sales.formulas[saleRow-1][17],`=IF(J${saleRow}="","",J${saleRow}-N${saleRow}-P${saleRow}-Q${saleRow})`);
  assert.equal(workbook.local.poizonOrders[order().orderNumber].purchaseRow,5);
  assert.equal(verifyPoizonRecordedSales(workbook,[order()],first.recorded),1);
  const second=reconcilePoizonOrders(workbook,[order()]);
  assert.equal(second.edits.length,0);assert.equal(second.recorded.length,0);
  assert.equal(sales.rawValues.filter(row=>row[2]?.value==='SR123UPS11').length,1);
});

test('readback verification rejects a changed saved sale',()=>{
  const workbook=book(),recorded=reconcilePoizonOrders(workbook,[order()]).recorded;
  workbook.sheets[1].rawValues[recorded[0].salesRow-1][9]={type:'number',value:'76000'};
  assert.throws(()=>verifyPoizonRecordedSales(workbook,[order()],recorded),/POIZON_LEDGER_SAVE_VERIFY_FAILED/);
});

test('an existing matching sales row receives the completed status before verification',()=>{
  const workbook=book(),sales=workbook.sheets[1],prior=structuredClone(workbook.sheets[0].rawValues[4]);
  prior[9]={type:'number',value:'75000'};prior[10]={type:'date',value:new Date('2026-09-16T00:00:00+09:00').toISOString()};
  sales.rawValues[4]=prior;
  const result=reconcilePoizonOrders(workbook,[order()]);
  assert.equal(result.review.length,0);
  assert.equal(result.recorded.length,1);
  assert.equal(sales.rawValues[4][11].value,'일판완료');
  assert.equal(verifyPoizonRecordedSales(workbook,[order()],result.recorded),1);
});

test('incomplete or ambiguous order never changes financial cells',()=>{
  const workbook=book(),purchase=workbook.sheets[0];
  const second=structuredClone(purchase.rawValues[4]);purchase.rawValues.push(second);purchase.displayValues.push(second.map(cell=>cell.value));
  purchase.formulas.push(second.map(cell=>cell.type==='formula'?cell.value:''));
  const result=reconcilePoizonOrders(workbook,[order(),{...order(),orderNumber:'21315202429263300',status:'판매자 발송 완료'}]);
  assert.equal(result.edits.length,0);assert.equal(result.review.length,2);
  assert.equal(purchase.rawValues[4][9].value,'');
});

test('a conflicting manual fee is sent to review',()=>{
  const workbook=book();workbook.sheets[0].rawValues[4][15]={type:'number',value:'12000'};
  const result=reconcilePoizonOrders(workbook,[order()]);
  assert.equal(result.edits.length,0);assert.match(result.review[0].reason,/수수료/);
});
