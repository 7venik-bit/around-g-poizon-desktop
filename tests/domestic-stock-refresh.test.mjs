import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const renderer=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');
const section=(start,end)=>renderer.slice(renderer.indexOf(start),renderer.indexOf(end,renderer.indexOf(start)));
for (const menu of ['브랜드 검색','카테고리']) test(`${menu}: the existing product search returns stock without a separate action`,async()=>{
  const calls=[],renders=[];
  const product={articleNumber:'JH9976',brandName:'Adidas'};
  const result={products:[{url:'https://www.musinsa.com/products/123',sizes:[{label:'270',quantity:3}]}],sources:[]};
  const context=createContext({excelPreviewBatchSearching:false,domesticBatchRunning:false,
    domesticBatchStopRequested:false,domesticStockOnly:false,excelPreviewProductCache:new Map(),
    currentExplorerProducts:[product],allExplorerProducts:[product],domesticResults:new Map(),
    hasDomesticStock:()=>true,
    cachedDomesticSearch:async(p,verify)=>{calls.push({p,verify});return {ok:true,data:result};},
    renderExplorerResults:(...args)=>renders.push(args),$:()=>({textContent:menu}),
  });
  runInContext(section('function domesticKey(', '\nfunction domesticBatchId('),context);
  runInContext(section('async function searchDomesticAt(', '\nasync function refresh('),context);
  assert.equal(await context.searchDomesticAt(0),result);
  assert.deepEqual(calls,[{p:product,verify:true}]);
  assert.equal(context.domesticResults.get('JH9976'),result);
  assert.equal(renders.length,1);
  assert.equal(context.domesticResults.get('JH9976').products[0].sizes[0].quantity,3);
});
