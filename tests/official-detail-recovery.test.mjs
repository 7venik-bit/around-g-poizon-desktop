import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {isOfficialProductCandidateUrl} from '../services/official-product-candidate.mjs';
import {captureRenderedStockEvidence,normalizeRenderedStockEvidence} from '../services/domestic-stock.mjs';
const main=fs.readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
function section(start,end){return main.slice(main.indexOf(start),main.indexOf(end,main.indexOf(start)));}

test('known official detail routes through the stock pipeline and rejects search/off-domain URLs',async()=>{
  let calls=0;
  const ctx=vm.createContext({URL,isOfficialProductCandidateUrl,renderedSearchSourceResult:async(source,code)=>{
    calls++;assert.equal(code,'JI0079');assert.deepEqual(Array.from(source.directProductUrls),['https://www.adidas.co.kr/shoe/JI0079.html']);
    return {products:[{price:149000}],detailVerificationPending:true};
  }});
  vm.runInContext(section('async function collectKnownOfficialDetail(', 'async function waitForDomesticCaptureReady('),ctx);
  const input={homepageUrl:'https://www.adidas.co.kr/',productUrl:'https://www.adidas.co.kr/shoe/JI0079.html',query:'JI0079'};
  const result=await ctx.collectKnownOfficialDetail(input);assert.equal(result.products[0].price,149000);assert.equal(result.detailVerificationPending,true);
  for(const url of ['https://attacker.example/JI0079.html','https://www.adidas.co.kr/search?q=JI0079','https://www.adidas.co.kr/'])await assert.rejects(ctx.collectKnownOfficialDetail({...input,productUrl:url}),/INVALID_OFFICIAL/);
  assert.equal(calls,1);
});

test('official import accepts exact-code html cards but rejects navigation and other models',async()=>{
  const d=new JSDOM('<main><li><a href="/shoe/JI0079.html"><img alt="JI0079"><h2>슈퍼스타 JI0079</h2><b>149,000원</b></a></li><a href="/search?q=JI0079">JI0079 검색</a><li><a href="/shoe/OTHER.html"><img><b>119,000원</b></a></li></main>',{url:'https://www.adidas.co.kr/search?q=JI0079',runScripts:'outside-only'});
  try {
    d.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
    Object.defineProperty(d.window.HTMLElement.prototype,'innerText',{get(){return this.textContent.replace(/JI0079(?=149)/g,'JI0079 ')}});
    const ctx=vm.createContext({browserWindowUsable:()=>true,wait:async()=>{},isOfficialProductCandidateUrl,captureRenderedStockEvidence,normalizeRenderedStockEvidence});
    const start=main.indexOf('async function collectOfficialMallSearchProducts(');
    vm.runInContext(main.slice(start,main.indexOf('\nasync function ',start+1)),ctx);
    const result=await ctx.collectOfficialMallSearchProducts({webContents:{mainFrame:{executeJavaScript:async code=>d.window.eval(code)}}},'JI0079');
    assert.equal(result.length,1);assert.equal(result[0].price,149000);
  }finally{d.window.close();}
});

test('detail collection updates the result row, retains other sellers, and preserves partial status',async()=>{
  const d=new JSDOM('<table><tr class="excel-product-search-detail"><td><button data-official-homepage="https%3A%2F%2Fwww.adidas.co.kr%2F" data-official-product-url="https%3A%2F%2Fwww.adidas.co.kr%2Fshoe%2FJI0079.html" data-official-query="JI0079" data-official-result-key="row1">상세 수집</button></td></tr></table>');
  const current={products:[{store:'무신사',url:'https://musinsa.com/products/1',price:100000}],sources:[{store:'브랜드 공식몰'}]};
  const results=new Map([['row1',current]]);let persisted=0;
  const ctx=vm.createContext({window:{aroundG:{openOfficialInternalSearch:async input=>{assert.match(input.productUrl,/JI0079/);return {ok:true,products:[{store:'브랜드 공식몰',url:input.productUrl,price:149000,sizes:[{label:'300',inStock:false}]}],detailVerificationPending:true};}}},document:d.window.document,
    domesticResults:new Map(),excelPreviewSearchResults:results,excelPreviewProductCache:new Map([['row1',{articleNumber:'JI0079'}]]),
    activeExcelPreview:{file:{path:'source.xlsx'}},persistExcelSearchResults:()=>persisted++,text:String,money:String,
    renderDomestic:(result)=>JSON.stringify(result)});
  const renderer=fs.readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');
  const start=renderer.indexOf('  const officialInternalButton =');const end=renderer.indexOf('  const officialButton =',start);
  const handler=vm.runInContext('(async event=>{'+renderer.slice(start,end)+'})',ctx);
  await handler({target:d.window.document.querySelector('button')});
  assert.equal(results.get('row1').products.length,2);assert.equal(results.get('row1').sources[0].verificationPending,true);
  assert.match(d.window.document.querySelector('td').textContent,/149000/);assert.equal(persisted,1);d.window.close();
});
