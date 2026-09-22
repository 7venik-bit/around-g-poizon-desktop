import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import fixture from './fixtures/ledger-layout-data.cjs';
const html=readFileSync(new URL('../src/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../src/ledger-workbook.js',import.meta.url),'utf8');
async function render(t,book) {
  const dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());
  const calls=[];
  dom.window.aroundG={loadLedgerWorkbook:async()=>({ok:true,workbook:book}),editLedgerWorkbookCell:async value=>{calls.push(value);return {ok:false};}};
  dom.window.eval(script);await new Promise(resolve=>setTimeout(resolve,20));
  return {d:dom.window.document,window:dom.window,calls};
}
test('ledger assigns semantic widths while preserving every displayed value, column and source format',async t=>{
  const book=fixture.ledgerLayoutBook(26),before=structuredClone(book),{d,calls}=await render(t,book);
  const table=d.querySelector('#workbook-table table'),rows=[...table.querySelectorAll('tbody tr')];
  assert.equal(table.querySelectorAll('col').length,27);
  assert.equal(table.querySelectorAll('thead th').length,27);
  assert.equal(rows.length,100);
  assert.ok(rows.every(row=>row.querySelectorAll('td').length===26));
  const cols=[...table.querySelectorAll('col')].map(col=>parseFloat(col.style.width));
  assert.ok(cols[4]>cols[3] && cols[3]>cols[5],'model and article get more room than gender');
  assert.ok(cols[20]>cols[26],'trailing blank columns stay editable without equal-sized empty space');
  for(const [r,row] of rows.entries()) assert.deepEqual([...row.querySelectorAll('td')].map(cell=>cell.textContent),Array.from({length:26},(_,c)=>book.sheets[0].displayValues[r]?.[c]||''));
  assert.equal(rows[1].className,'workbook-data-header');
  assert.equal(rows[2].children[2].dataset.columnKind,'link');
  assert.equal(rows[2].children[4].dataset.columnKind,'model');
  assert.equal(rows[2].children[10].style.backgroundColor,'rgb(255, 230, 153)');
  assert.equal(rows[0].children[20].title,'#VALUE!\n=1+" "');
  assert.equal(calls.length,0);assert.deepEqual(book,before);
});
test('clipped links retain their full tooltip and edit value at the original sheet coordinate',async t=>{
  const book=fixture.ledgerLayoutBook(),{d,calls}=await render(t,book);
  const link=d.querySelectorAll('#workbook-table tbody tr')[2].children[2];
  assert.equal(link.title,book.sheets[0].displayValues[2][1]);link.dispatchEvent(new d.defaultView.MouseEvent('dblclick',{bubbles:true}));
  assert.equal(d.querySelector('#workbook-selection').textContent,'B3');
  assert.equal(d.querySelector('#workbook-cell-value').value,book.sheets[0].rawValues[2][1].value);
  assert.equal(d.querySelector('#workbook-cell-value').closest('td'),link);
  assert.equal(calls.length,0);
  d.querySelector('#workbook-next').click();
  const next=d.querySelector('#workbook-table tbody tr');assert.equal(next.firstChild.textContent,'101');
  next.children[3].dispatchEvent(new d.defaultView.MouseEvent('dblclick',{bubbles:true}));assert.equal(d.querySelector('#workbook-selection').textContent,'C101');
  assert.equal(d.querySelector('#workbook-cell-value').value,book.sheets[0].rawValues[100][2].value);
});
test('ragged generic sheets keep aligned cells and literal text without inventing a header',async t=>{
  const book={title:'예시',sheets:[{id:1,name:'메모',displayValues:[['00123'],['<img src=x onerror=alert(1)>','긴 메모']],formulas:[],rawValues:[[{type:'text',value:'00123'}]]}]};
  const {d}=await render(t,book),rows=[...d.querySelectorAll('#workbook-table tbody tr')];
  assert.deepEqual(rows.map(row=>row.children.length),[3,3]);
  assert.equal(d.querySelector('.workbook-data-header'),null);
  assert.equal(d.querySelector('#workbook-table img'),null);
  assert.equal(rows[0].children[1].textContent,'00123');
  assert.ok(d.querySelector('link[href="./ledger-workbook.css"]'));
  assert.ok(d.querySelector('.workbook-hidden-toggle #workbook-hidden'));
});

test('wide ledgers reserve readable minimum widths from original long codes, brands and margins',async t=>{
  const book=fixture.ledgerLayoutBook(30),before=structuredClone(book),{d,calls}=await render(t,book);
  const table=d.querySelector('#workbook-table table'),cols=[...table.querySelectorAll('col')];
  const minimum=parseFloat(table.style.minWidth),cells=table.querySelectorAll('tbody tr')[2].children;
  assert.ok(minimum>1200,'30 original columns must scroll instead of squeezing values');
  assert.ok(minimum*parseFloat(cols[3].style.width)/100>110,'full long article code gets readable width');
  assert.ok(minimum*parseFloat(cols[1].style.width)/100>75,'Korean brand text gets readable width');
  assert.equal(cells[21].dataset.columnKind,'percent');
  assert.equal(cells[22].textContent,'-876.02%');
  assert.equal(cells[3].textContent,'ABCD000-N50CRS');
  assert.equal(cells[3].style.fontWeight,'bold');
  assert.equal(calls.length,0);assert.deepEqual(book,before);
});

test('photo cells render literal IMAGE formulas and legacy links without changing originals or edit coordinates',async t=>{
  const book=fixture.ledgerLayoutBook(22),sheet=book.sheets[0];
  const photo='https://images.example.test/photo.jpg?w=500';
  sheet.formulas[2][7]=`=IMAGE("${photo}",1)`;sheet.displayValues[2][7]='';sheet.rawValues[2][7]={type:'formula',value:sheet.formulas[2][7]};
  sheet.displayValues[3][7]=photo;sheet.rawValues[3][7]={type:'text',value:photo};
  sheet.formulas[4][7]='=IMAGE(IMPORTXML("https://evil.test","//x"))';
  sheet.formulas[5][7]='=IMAGE("javascript:alert(1)")';
  const before=structuredClone(book),{d,window,calls}=await render(t,book);
  const rows=d.querySelectorAll('#workbook-table tbody tr'),cell=rows[2].children[8];
  assert.equal(cell.dataset.columnKind,'image');assert.equal(cell.querySelector('img').src,photo);
  assert.equal(rows[3].children[8].querySelector('img').src,photo);
  assert.equal(rows[4].children[8].querySelector('img'),null);assert.equal(rows[5].children[8].querySelector('img'),null);
  cell.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true}));assert.equal(d.querySelector('#workbook-selection').textContent,'H3');
  assert.equal(d.querySelector('#workbook-cell-value').value,sheet.formulas[2][7]);
  d.querySelector('#workbook-cell-value').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  cell.querySelector('img').dispatchEvent(new window.Event('error'));assert.equal(cell.textContent,'사진 확인 필요');
  assert.equal(calls.length,0);assert.deepEqual(book,before);
});
