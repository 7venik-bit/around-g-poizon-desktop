import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const html=readFileSync(new URL('../src/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../src/ledger-workbook.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
async function setup(t) {
  const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
  const raw=[['브랜드','품번','모델명','판매가 (원화)','구매일자','상태','한국 사이즈'],
    ['TEST','00123','기존 상품',75000,'2026-09-21T15:00:00.000Z','구매완료','095'],
    ['TEST','00007','',0,'','','ONE']].map(row=>row.map(value=>({type:typeof value==='number'?'number':'text',value:String(value)})));
  raw[1][4].type='date';
  let book={title:'장부',revision:'r1',timeZone:'Asia/Seoul',sheets:[{id:1,name:'1-구매완료',rowCount:102,columnCount:7,rawValues:raw,
    displayValues:raw.map(row=>row.map(cell=>cell.value)),formulas:raw.map(row=>row.map(()=>'')),validations:[[],[null,null,null,null,null,{type:'list',values:['구매완료','반품완료']}]],
    calculatedValues:[[],[],[],[null,null,null,{type:'number',value:-15000}]]}]};
  book.sheets[0].displayValues.push(['','','','-15000']);
  const source=structuredClone(book),calls=[];
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.aroundG={loadLedgerWorkbook:async()=>({ok:true,workbook:book}),editLedgerWorkbookCell:async edit=>{
    calls.push(JSON.parse(JSON.stringify(edit)));book=structuredClone(book);book.revision+='x';
    const s=book.sheets[0],r=edit.row-1,c=edit.column-1;
    (s.rawValues[r]||=[])[c]={...edit.next};(s.displayValues[r]||=[])[c]=edit.next.value;
    return {ok:true,workbook:book};
  }};
  w.eval(script);await tick();
  const cell=(r,c)=>d.querySelector(`td[data-row="${r}"][data-column="${c}"]`);
  const key=(target,key,options={})=>target.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
  const open=(r,c)=>{cell(r,c).dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));return d.querySelector('#workbook-cell-value');};
  return {w,d,cell,key,open,calls,source,book:()=>book};
}

test('click only selects; F2/double click edits inside the cell; Escape keeps original values with no writes',async t=>{
  const {d,cell,key,open,calls}=await setup(t);
  cell(2,3).click();assert.equal(d.querySelector('#workbook-cell-editor'),null);
  key(cell(2,3),'F2');const input=d.querySelector('#workbook-cell-value');
  assert.equal(input.closest('td'),cell(2,3));assert.equal(input.value,'기존 상품');
  input.value='취소할 상품';key(input,'Escape');await tick();
  assert.equal(d.querySelector('#workbook-cell-editor'),null);assert.equal(cell(2,3).textContent,'기존 상품');assert.equal(calls.length,0);
  assert.equal(open(2,2).value,'00123');
  assert.equal(d.querySelector('#original-ledger-workbook > #workbook-cell-editor'),null);
});

test('typing replaces a selected value, Enter saves once, Tab uses the refreshed revision and moves horizontally',async t=>{
  const {d,cell,key,open,calls}=await setup(t);
  cell(2,3).click();key(cell(2,3),'새');const input=d.querySelector('#workbook-cell-value');assert.equal(input.value,'새');
  input.value='새 상품';key(input,'Enter');await tick();
  assert.equal(cell(2,3).textContent,'새 상품');assert.equal(d.querySelector('#workbook-selection').textContent,'C3');
  assert.deepEqual(calls[0],{sheetId:1,row:2,column:3,revision:'r1',expected:{type:'text',value:'기존 상품'},next:{type:'text',value:'새 상품'}});
  const money=open(3,4);money.value='₩75,000';key(money,'Tab');await tick();
  assert.equal(calls.length,2);assert.equal(calls[1].revision,'r1x');assert.deepEqual(calls[1].next,{type:'number',value:'75000'});
  assert.equal(cell(3,4).textContent,'₩75,000');assert.equal(d.querySelector('#workbook-selection').textContent,'E3');
  key(cell(3,5),'Tab',{shiftKey:true});assert.equal(d.querySelector('#workbook-selection').textContent,'D3');
});

test('currency display handles existing numbers, zero and calculated negatives without mutating source, codes or dates',async t=>{
  const {cell,book,source}=await setup(t);
  assert.equal(cell(2,4).textContent,'₩75,000');assert.equal(cell(3,4).textContent,'₩0');assert.equal(cell(4,4).textContent,'-₩15,000');
  assert.equal(cell(2,2).textContent,'00123');assert.equal(cell(2,7).textContent,'095');assert.deepEqual(book(),source);
});

test('input inference keeps codes and sizes as text, supports explicit text/formulas, dates and dropdowns',async t=>{
  const {d,key,open,calls}=await setup(t);
  for(const [r,c,value,expected] of [[2,2,'000008',{type:'text',value:'000008'}],[2,7,'090',{type:'text',value:'090'}],
    [3,3,"'=1+2",{type:'text',value:'=1+2'}],[3,3,'=SUM(D2:D3)',{type:'formula',value:'=SUM(D2:D3)'}],
    [2,4,'75,000원',{type:'number',value:'75000'}],[2,5,'2026-09-23',{type:'date',value:'2026-09-23'}],
    [2,6,'반품완료',{type:'text',value:'반품완료'}],[2,4,'',{type:'text',value:''}]]) {
    const input=open(r,c);if(c===5)assert.equal(input.value,'2026-09-22');
    if(c===6)assert.deepEqual([...d.querySelectorAll('datalist option')].map(n=>n.value),['구매완료','반품완료']);
    input.value=value;key(input,'Enter');await tick();assert.deepEqual(calls.at(-1).next,expected);
  }
});

test('Korean composition Enter cannot submit until composition ends',async t=>{
  const {w,key,open,calls}=await setup(t),input=open(2,3);
  input.dispatchEvent(new w.CompositionEvent('compositionstart'));input.value='한글 상품';key(input,'Enter',{isComposing:true});key(input,'Enter');await tick();assert.equal(calls.length,0);
  input.dispatchEvent(new w.CompositionEvent('compositionend'));key(input,'Enter');await tick();assert.equal(calls.length,1);assert.equal(calls[0].next.value,'한글 상품');
});

test('money and date column headings remain editable as ordinary text',async t=>{
  const {key,open,calls}=await setup(t);
  const input=open(1,4);input.value='판매가';key(input,'Enter');await tick();
  assert.deepEqual(calls[0].next,{type:'text',value:'판매가'});
  const date=open(1,5);date.value='주문일자';key(date,'Enter');await tick();
  assert.deepEqual(calls[1].next,{type:'text',value:'주문일자'});
});

test('validation failure retains an editable draft; correction saves without losing the selected coordinate',async t=>{
  const {w,d,key,open,calls}=await setup(t),save=w.aroundG.editLedgerWorkbookCell;
  w.aroundG.editLedgerWorkbookCell=async()=>({ok:false,code:'CELL_NUMBER_INVALID'});
  const input=open(2,4);input.value='75,00';key(input,'Enter');await tick();
  assert.equal(input.value,'75,00');assert.equal(input.disabled,false);assert.equal(input.getAttribute('aria-invalid'),'true');assert.equal(d.activeElement,input);assert.equal(d.querySelector('#workbook-export').disabled,false);
  input.blur();await tick();assert.equal(calls.length,0);
  w.aroundG.editLedgerWorkbookCell=save;input.value='76000';input.dispatchEvent(new w.Event('input'));key(input,'Enter');await tick();assert.equal(calls.length,1);assert.equal(calls[0].row,2);
});

test('blur saves once, while switching to a clicked cell waits for persistence and follows its coordinate',async t=>{
  const {d,cell,open,calls}=await setup(t),input=open(2,3);input.value='포커스 저장';input.blur();await tick();assert.equal(calls.length,1);
  const next=open(2,3);next.value='다음 셀 클릭';cell(3,2).click();await tick();
  assert.equal(calls.length,2);assert.equal(d.querySelector('#workbook-selection').textContent,'B3');
});

test('a pending save locks navigation and prevents duplicate Enter/blur writes; conflict blocks stale exports',async t=>{
  const {w,d,cell,key,open}=await setup(t);let finish,count=0;
  w.aroundG.editLedgerWorkbookCell=()=>{count++;return new Promise(resolve=>{finish=resolve;});};
  const input=open(2,4);input.value='76000';key(input,'Enter');key(input,'Enter');input.blur();cell(3,1).click();await tick();
  assert.equal(count,1);assert.equal(input.disabled,true);assert.equal(d.querySelector('#workbook-next').disabled,true);
  finish({ok:false,code:'CELL_CONFLICT'});await tick();
  assert.equal(input.value,'76000');assert.equal(input.disabled,true);assert.equal(d.querySelector('#workbook-export').disabled,true);
});

test('Enter from row 100 saves and opens row 101 instead of resetting the viewport or target',async t=>{
  const {d,key,open,calls}=await setup(t),input=open(100,3);input.value='100행 상품';key(input,'Enter');await tick();
  assert.equal(calls[0].row,100);assert.equal(d.querySelector('#workbook-selection').textContent,'C101');assert.match(d.querySelector('#workbook-page').textContent,/101–102/);
});
