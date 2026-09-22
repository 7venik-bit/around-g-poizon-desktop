import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../src/ledger-workbook.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,40));
async function setup(t) {
 const dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());
 let book={title:'검증',revision:'r1',sheets:[{id:1,name:'구매',rowCount:102,columnCount:3,displayValues:[['001','공용','구매완료'],['A','B','C']],formulas:[['','',''],['','','']],rawValues:[['001','공용','구매완료'],['A','B','C']].map(row=>row.map(value=>({type:'text',value})))}]};
 const calls=[];let copied;
 const action=async(type,input)=>{calls.push({type,input});book=structuredClone(book);book.revision+='x';
  if(type==='resize')for(const change of input.changes)(book.sheets[0][change.axis==='column'?'columnWidths':'rowHeights']||={})[change.index]=change.pixels;
  return {ok:true,workbook:book};
 };
 dom.window.aroundG={loadLedgerWorkbook:async()=>({ok:true,workbook:book}),clearLedgerWorkbookCells:input=>action('clear',input),pasteLedgerWorkbookCells:input=>action('paste',input),resizeLedgerWorkbook:input=>action('resize',input),copyLedgerWorkbookCells:async input=>{copied=input;calls.push({type:'copy',input});return {ok:true};}};
 dom.window.eval(script);await tick();
 const d=dom.window.document,cell=(r,c)=>d.querySelector(`td[data-row="${r}"][data-column="${c}"]`);
 const key=(target,key,options={})=>target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
 return {dom,d,cell,key,calls,getCopied:()=>copied};
}
test('Shift selection, Ctrl+C/V and Delete send the same exact range once without intercepting editor text',async t=>{
 const {dom,d,cell,key,calls}=await setup(t);
 cell(1,2).click();assert.equal(d.activeElement,cell(1,2));
 cell(2,3).dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,shiftKey:true}));
 assert.equal(d.getElementById('workbook-selection').textContent,'B1:C2');assert.equal(d.querySelectorAll('.workbook-selected').length,4);assert.equal(d.getElementById('workbook-cell-editor').hidden,true);
 key(cell(2,3),'c',{ctrlKey:true});await tick();
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].input.range)),{row:1,column:2,endRow:2,endColumn:3});
 cell(2,1).click();key(cell(2,1),'v',{ctrlKey:true});await tick();assert.equal(calls[1].type,'paste');assert.equal(calls[1].input.range.column,1);
 key(d.getElementById('workbook-table'),'Delete');await tick();assert.equal(calls[2].type,'clear');assert.equal(calls.length,3);
 cell(1,2).click();const editor=d.getElementById('workbook-cell-value');editor.focus();key(editor,'Delete');key(editor,'c',{ctrlKey:true});await tick();assert.equal(calls.length,3);
});
test('numeric size controls and drag handles persist bounded dimensions once; changing pages clears stale selection',async t=>{
 const {dom,d,cell,calls}=await setup(t);cell(2,2).click();
 d.getElementById('workbook-cell-value').value='저장 전 편집';
 d.getElementById('workbook-column-width').value='220';d.getElementById('workbook-row-height').value='80';d.getElementById('workbook-size-save').click();await tick();
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].input.changes)),[{axis:'column',index:2,pixels:220},{axis:'row',index:2,pixels:80}]);
 assert.equal(d.querySelector('[data-row-number="2"]').style.getPropertyValue('--workbook-row-height'),'80px');
 assert.equal(d.getElementById('workbook-cell-value').value,'저장 전 편집');
 assert.equal(d.getElementById('workbook-cell-editor').hidden,false);
 const handle=d.querySelector('.workbook-column-resize');handle.parentElement.getBoundingClientRect=()=>({width:100});
 handle.dispatchEvent(new dom.window.MouseEvent('pointerdown',{button:0,clientX:100,bubbles:true,cancelable:true}));
 dom.window.dispatchEvent(new dom.window.MouseEvent('pointermove',{clientX:160}));assert.equal(calls.length,1);
 dom.window.dispatchEvent(new dom.window.MouseEvent('pointerup',{clientX:160}));await tick();assert.equal(calls.length,2);assert.equal(calls[1].input.changes[0].pixels,160);
 d.getElementById('workbook-next').click();assert.equal(d.getElementById('workbook-cell-clear').disabled,true);assert.equal(d.querySelectorAll('.workbook-selected').length,0);
});
test('failed whole-block paste reports validation without hiding original data or allowing uncertain exports',async t=>{
 const {dom,d,cell}=await setup(t);cell(1,1).click();
 dom.window.aroundG.pasteLedgerWorkbookCells=async()=>({ok:false,code:'CELL_VALIDATION_FAILED'});
 d.getElementById('workbook-cell-paste').click();await tick();assert.equal(cell(1,1).textContent,'001');assert.match(d.getElementById('workbook-status').textContent,/허용 값/);assert.equal(d.getElementById('workbook-export').disabled,false);
 dom.window.aroundG.pasteLedgerWorkbookCells=async()=>({ok:false,code:'DISK_FULL'});
 d.getElementById('workbook-cell-paste').click();await tick();assert.equal(d.getElementById('workbook-export').disabled,true);assert.equal(d.getElementById('workbook-cell-clear').disabled,true);
});
