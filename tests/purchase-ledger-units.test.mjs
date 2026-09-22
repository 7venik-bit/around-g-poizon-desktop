import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../services/google-ledger-apps-script.gs',import.meta.url),'utf8');
function fixture() {
  const data=new Map(), notes=new Map(); let writes=0, failWrite=false, max=20;
  const sheet={
    getLastRow:()=>Math.max(2,...data.keys()),getMaxRows:()=>max,
    insertRowsAfter:(_r,n)=>{max+=n;}, setRowHeights:()=>{},
    getRange:(row,column,rows=1,columns=1)=>({
      getNotes:()=>Array.from({length:rows},(_,i)=>[notes.get(row+i)||'']),
      setNotes:(input)=>{input.forEach((v,i)=>notes.set(row+i,v[0]));},
      setValues:(input)=>{writes++;if(failWrite)throw Error('interrupted');input.forEach((v,i)=>data.set(row+i,[...v]));},
      getValues:()=>[data.get(row)||Array(14).fill('')],
      getFormula:()=>data.get(row)?.[column-1]||'',
    })
  };
  const context=vm.createContext({SpreadsheetApp:{flush(){}},Utilities:{formatDate:v=>v.toISOString().slice(0,10)}});
  vm.runInContext(source,context);
  const row={orderNumber:'TEST-ORDER',orderEvidence:{orderLineId:'line-1'},brand:'브랜드',articleNumber:'TEST001',
    modelName:'테스트 조끼',krSize:'BLACK · 105',purchaseUrl:'https://www.musinsa.com/products/123',
    imageUrl:'https://images.example.test/vest.jpg',purchaseDate:'2026-09-17',quantity:3,purchasePrice:10001};
  return {sheet,row,data,notes,run:(r=row)=>JSON.parse(JSON.stringify(context.appendPurchaseUnits_(sheet,r))),
    writes:()=>writes,interrupt:()=>{failWrite=true;}};
}
test('three unit rows retain every photo and the exact receipt total',()=>{
  const f=fixture(),result=f.run();assert.equal(result.ok,true);
  assert.deepEqual(result.unitPrices,[3334,3334,3333]);assert.deepEqual(result.rowNumbers,[3,4,5]);
  assert.equal([...f.data.values()].reduce((s,r)=>s+r[13],0),10001);
  for(const row of f.data.values())assert.equal(row[7],'=IMAGE("https://images.example.test/vest.jpg",1)');
  assert.equal(f.writes(),1);
});
test('repeating a receipt reuses all rows but another identical receipt line remains separate',()=>{
  const f=fixture();f.run();const duplicate=f.run();assert.equal(duplicate.duplicate,true);assert.equal(f.writes(),1);
  assert.deepEqual(f.run({...f.row,orderEvidence:{orderLineId:'line-2'}}).rowNumbers,[6,7,8]);
});
test('changed totals or quantity require review instead of appending',()=>{
  const f=fixture();f.run();
  for(const change of [{purchasePrice:11000},{quantity:2}])assert.equal(f.run({...f.row,...change}).code,'PURCHASE_RECEIPT_CONFLICT');
  f.data.get(3)[13]=1;assert.equal(f.run().code,'PURCHASE_RECEIPT_REVIEW');assert.equal(f.writes(),1);
});
test('a write interrupted after reserving the receipt cannot duplicate rows on retry',()=>{
  const f=fixture();f.interrupt();assert.throws(()=>f.run(),/interrupted/);
  assert.equal(f.run().code,'PURCHASE_RECEIPT_REVIEW');assert.equal(f.writes(),1);
});
test('invalid unit totals, identity, or image perform no writes',()=>{
  const f=fixture();
  for(const change of [{quantity:0},{quantity:1.5},{quantity:1001},{purchasePrice:2},{purchasePrice:1.5},{orderEvidence:{}},{imageUrl:'javascript:bad'}]) {
    assert.equal(f.run({...f.row,...change}).ok,false);
  }
  assert.equal(f.writes(),0);
});
test('a lost photo or missing unit marker requires review',()=>{
  const f=fixture();f.run();f.data.get(3)[7]='';assert.equal(f.run().code,'PURCHASE_RECEIPT_REVIEW');
  f.notes.delete(4);assert.equal(f.run().code,'PURCHASE_RECEIPT_CONFLICT');assert.equal(f.writes(),1);
});
