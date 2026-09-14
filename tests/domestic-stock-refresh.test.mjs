import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const renderer=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');
const section=(start,end)=>renderer.slice(renderer.indexOf(start),renderer.indexOf(end,renderer.indexOf(start)));
for (const menu of ['브랜드 검색','카테고리']) test(`${menu}: stock action refreshes the common explorer search with the selected product`,async()=>{
  const calls=[],renders=[],cleared=[];
  const product={articleNumber:'JH9976',brandName:'Adidas'};
  const result={products:[{url:'https://www.musinsa.com/products/123',sizes:[{label:'270',quantity:3}]}],sources:[]};
  const context=createContext({excelPreviewBatchSearching:false,domesticBatchRunning:false,
    domesticBatchStopRequested:false,domesticStockOnly:false,excelPreviewProductCache:new Map(),
    currentExplorerProducts:[product],allExplorerProducts:[product],domesticResults:new Map(),
    clearDomesticIdentityCache:p=>cleared.push(p),hasDomesticStock:()=>true,
    cachedDomesticSearch:async(p,verify)=>{calls.push({p,verify});return {ok:true,data:result};},
    renderExplorerResults:(...args)=>renders.push(args),$:()=>({textContent:menu}),
  });
  runInContext(section('function domesticKey(', '\nfunction domesticBatchId('),context);
  runInContext(section('async function searchDomesticAt(', '\nasync function refresh('),context);
  runInContext(section('let domesticStockRefreshRunning =', '\nasync function showExcelPreview('),context);
  assert.equal(await context.refreshDomesticStock('JH9976'),true);
  assert.deepEqual(cleared,[product]);
  assert.deepEqual(calls,[{p:product,verify:true}]);
  assert.equal(context.domesticResults.get('JH9976'),result);
  assert.equal(renders.length,1);
  context.domesticBatchRunning=true;
  assert.equal(await context.refreshDomesticStock('JH9976'),false);
  assert.equal(calls.length,1,'do not overlap an active common search');
});
