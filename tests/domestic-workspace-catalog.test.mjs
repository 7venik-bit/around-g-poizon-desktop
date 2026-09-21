import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

test('opening domestic products collapses the full catalog before Excel work while preserving selection', async t => {
  const dom = new JSDOM('<details id="brand-picker" open><summary>Brands</summary><button class="selected" data-brand-id="1">DESCENTE</button></details><p id="brand-status"></p>');
  t.after(()=>dom.window.close());
  const document=dom.window.document, picker=document.querySelector('details');
  const renderer=(await readFile(new URL('../src/renderer.js',import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start=renderer.indexOf('async function openCombinedSelectedBrandPreview(');
  const end=renderer.indexOf('\n}\n',start)+2;
  const product={articleNumber:'SR123UPS11'};
  const context=vm.createContext({
    $:selector=>document.querySelector(selector),
    window:{aroundG:{previewExcelFile:async()=>{assert.equal(picker.open,false);return {ok:true,products:[product]};}}},
    mergeDomesticSearchProducts:products=>products,
    combinedBrandPreview:null,excelPreviewIntegrated:false,
    selectedExcelPreviewProducts:new Set(),excelPreviewProductCache:new Map(),
    openIntegratedBrandExcel:async()=>{},restoreSavedExcelSearchResults:()=>{},
    excelPreviewStableSelectionKey:p=>p.articleNumber,renderCombinedBrandPreviewPage:()=>{},
  });
  vm.runInContext(renderer.slice(start,end),context);
  await context.openCombinedSelectedBrandPreview([{path:'fixture.xlsx'}]);
  assert.equal(document.querySelectorAll('[data-brand-id].selected').length,1);
  assert.equal(context.combinedBrandPreview.products[0],product);
  picker.open=true;
  assert.equal(document.querySelector('[data-brand-id]').textContent,'DESCENTE');
});
