import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
const source=readFileSync(new URL('../services/google-ledger-apps-script.gs',import.meta.url),'utf8');

function bridge(existing=[]) {
  const writes=[],formats=[],notes=new Map(),data=new Map(existing.map((row,i)=>[i+3,row]));
  const sheet={getLastRow:()=>Math.max(2,...data.keys()),getMaxRows:()=>1002,setRowHeights:()=>{},getRange:(r,c,n=1,w=1)=>({
    getValues:()=>[data.get(r)?.slice(0,w)||[]],
    getNotes:()=>Array.from({length:n},(_,i)=>[notes.get(r+i)||'']),
    setNotes:values=>values.forEach((row,i)=>notes.set(r+i,row[0])),
    setValues:values=>{writes.push({r,c,values});values.forEach((row,i)=>data.set(r+i,[...row]));},
    copyTo:(target,type)=>formats.push(type),getFormula:()=>data.get(r)?.[c-1]||'',
  })};
  const context=createContext({
    ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({setMimeType:()=>JSON.parse(value)})},
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'fixture-secret'})},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush:()=>{},CopyPasteType:{PASTE_FORMAT:'format'}},
    Utilities:{formatDate:()=> '2026-09-22'},
  });runInContext(source,context);
  return {context,writes,formats,post:row=>context.doPost({postData:{contents:JSON.stringify({secret:'fixture-secret',row:{orderNumber:'fixture-order',orderEvidence:{orderLineId:'fixture-line'},...row}})}})};
}
const row={brand:'테스트',articleNumber:'AB123',modelName:'상품',krSize:'블랙 / 270',euSize:'',gender:'공용',purchaseUrl:'https://www.musinsa.com/products/10001',imageUrl:'https://images.example.test/product.jpg?w=500&quality=90',purchasePrice:62330,purchaseDate:'2026-09-22'};

test('Google bridge appends a fitted product photo in H while preserving purchase fields and existing rows',()=>{
  const {context,post,writes,formats}=bridge();const result=post(row);
  assert.equal(result.ok,true);assert.equal(result.rowNumber,3);assert.equal(result.imageStatus,'formula');
  assert.ok(context.doGet().capabilities.includes('purchase.image.v1'));
  assert.ok(writes.every(write=>write.r===3&&write.c===1));
  const values=writes.at(-1).values[0];assert.equal(values.length,14);
  assert.equal(values[7],`=IMAGE("${row.imageUrl}",1)`);assert.equal(values[1],row.purchaseUrl);
  assert.equal(values[2],row.articleNumber);assert.equal(values[6],row.krSize);assert.equal(values[13],62330);
  assert.deepEqual(formats,[]);
});
test('Google image writes reject untrusted formulas and missing photos before changing cells',()=>{
  for(const imageUrl of ['', '=IMAGE("https://evil.test/image")', 'javascript:alert(1)', 'http://example.test/a.jpg', 'https://user:pass@example.test/a.jpg', 'https://example.test/a"),IMPORTXML("https://evil.test","//x")', 'https://example.test/a.svg']) {
    const {post,writes}=bridge();const result=post({...row,imageUrl});assert.equal(result.code,'PRODUCT_IMAGE_REQUIRED');assert.equal(writes.length,0);
  }
});
test('a duplicate order never overwrites the original photo or any existing cells',()=>{
  const existing=Array(30).fill('');existing[1]=row.purchaseUrl;existing[6]=row.krSize;existing[7]='기존 사진';
  const {post,writes}=bridge([existing]);assert.equal(post(row).rowNumber,4);const result=post(row);
  assert.equal(result.duplicate,true);assert.equal(result.imageStatus,'formula');assert.equal(writes.length,1);assert.equal(existing[7],'기존 사진');
});
