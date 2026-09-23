import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('a purchase row exposes its product photo and saves a reviewed fee category to that row',async()=>{
  const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../src/ledger-workbook.js',import.meta.url),'utf8');
  const headers=['브랜드','구매링크','품번','모델명','성별','EU 사이즈','한국 사이즈','사진','판매량','판매가 (원화)','판매 일자','상태','구매 일자','구매가','카드','예상 수수료','택배비','간이마진','부가세환급','일반마진','구매가비 마진율','판매가비 마진율','카테고리'];
  const rawValues=[[],headers.map(value=>({type:'text',value})),Array.from({length:23},()=>({type:'text',value:''}))];
  rawValues[2][0]={type:'text',value:'TEST'};rawValues[2][2]={type:'text',value:'BAG-123'};
  rawValues[2][3]={type:'text',value:'이름만으로 알 수 없는 상품'};
  rawValues[2][7]={type:'formula',value:'=IMAGE("https://example.com/product.jpg",1)'};
  rawValues[2][13]={type:'number',value:'100000'};
  const sheet={id:1,name:'1-구매완료',rowCount:3,columnCount:23,rawValues,
    displayValues:rawValues.map(row=>row.map(cell=>cell.type==='formula'?'':cell.value)),
    formulas:rawValues.map(row=>row.map(cell=>cell.type==='formula'?cell.value:''))};
  const book={title:'로컬 장부',revision:'r1',sheets:[sheet],local:{categories:{1:{column:23,rows:{3:{status:'missing'}}}}}};
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://app.example/'});
  let saved;
  dom.window.aroundG={loadLedgerWorkbook:async()=>({ok:true,workbook:book}),editLedgerWorkbookCell:async edit=>{
    saved=JSON.parse(JSON.stringify(edit));return {ok:true,workbook:{...book,revision:'r2'}};
  }};
  dom.window.eval(script);
  await new Promise(resolve=>setTimeout(resolve,30));
  const document=dom.window.document;
  document.querySelector('#workbook-table td[data-row="3"][data-column="3"]').click();
  assert.equal(document.getElementById('workbook-category-review').disabled,false);
  document.getElementById('workbook-category-review').click();
  assert.equal(document.getElementById('workbook-category-panel').hidden,false);
  assert.equal(document.getElementById('workbook-category-photo').src,'https://example.com/product.jpg');
  document.getElementById('workbook-category-choice').value='가방 및 캐리어';
  document.getElementById('workbook-category-save').click();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.deepEqual(saved,{sheetId:1,row:3,column:23,revision:'r1',expected:{type:'text',value:''},next:{type:'text',value:'가방 및 캐리어'}});
  dom.window.close();
});
