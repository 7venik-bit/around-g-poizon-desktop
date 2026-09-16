import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';
import * as relay from '../relay/domestic-search.mjs';

// Offline fixtures exercise the shipping DOM capture, matcher and renderer.
// The fixture markup is not a claim about the live Crocs DOM.
const main=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
const inline=readFileSync(new URL('../src/domestic-inline-results.js',import.meta.url),'utf8');
const pageUrl='https://www.crocs.co.kr/search?q=207521-001';
const productUrl='https://www.crocs.co.kr/p/classic-crush-clog/207521.html?cgid=women&cid=001';
const product='<li><a href="'+productUrl+'"><img src="https://images.test/item.jpg" alt="크록스 클래식 크러쉬 클로그 블랙"></a><strong>크록스 클래식 크러쉬 클로그 블랙</strong><span>207521-001</span><span class="price">79,000원</span></li>';
function page(t,html,url=pageUrl){
 const dom=new JSDOM('<body>'+html+'</body>',{url,runScripts:'outside-only',pretendToBeVisual:true});
 Object.defineProperty(dom.window.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
 dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:180,height:100});
 t.after(()=>dom.window.close());return dom;
}
function capture(t,html){
 const marker='let content = await searchWindow.webContents.mainFrame.executeJavaScript(';
 const begin=main.indexOf(marker,main.indexOf('async function renderedSearchSourceResult('))+marker.length;
 const end=main.indexOf('`, true).catch(error => {',begin);
 assert.ok(begin>=marker.length && end>begin);
 const code=runInNewContext(main.slice(begin,end+1),{...relay,articleNumber:'207521-001',source:{store:'브랜드 공식몰'},naverChannelCounts:null});
 return JSON.parse(page(t,html).window.eval(code));
}
const analyze=cards=>relay.analyzeRenderedChannelProducts(JSON.stringify({pageUrl,productCards:cards}), '브랜드 공식몰','207521-001','크록스','크러쉬 클로그');
for(const title of ['메인 컨텐츠로 건너뛰기','메인 콘텐츠로 건너뛰기','Skip to main content']){
 test('capture excludes a same-document accessibility link: '+title,t=>{
  const result=capture(t,`<a href="#main-content">${title}</a><main id="main-content">상품 검색</main>`);
  assert.equal(result.productCards.length,0,JSON.stringify(result.productCards));
 });
 test('matcher rejects previously captured navigation: '+title,()=>{
  const result=analyze([{productUrl:pageUrl,title,text:title}]);
  assert.equal(result.products.length,0);assert.equal(result.absenceConfirmed,false);
 });
}
test('a navigation-only page is never proof of product absence',t=>{
 const rendered=capture(t,'<a href="#main">메인 콘텐츠로 건너뛰기</a><main id="main">불러오는 중</main>');
 const result=analyze(rendered.productCards);assert.equal(result.products.length,0);assert.equal(result.absenceConfirmed,false);
});
test('real priced Crocs card survives beside skip and navigation links',t=>{
 const rendered=capture(t,'<a href="#main-content">메인 컨텐츠로 건너뛰기</a><nav><a href="'+pageUrl+'">207521-001 검색</a></nav><main id="main-content"><ul>'+product+'</ul></main>');
 assert.deepEqual(rendered.productCards.map(p=>p.productUrl),[productUrl]);
 const r=analyze(rendered.productCards);assert.equal(r.products.length,1);assert.equal(r.products[0].price,79000);
});
test('real product link can carry a product-specific fragment',t=>{
 const rendered=capture(t,'<main><ul>'+product.replaceAll(productUrl,productUrl+'#details')+'</ul></main>');
 assert.equal(rendered.productCards.length,1);assert.equal(rendered.productCards[0].productUrl,productUrl);
});
test('real image/card markup in an open shadow root remains collectable',t=>{
 const dom=page(t,'<section id="root"></section>');
 dom.window.document.querySelector('#root').attachShadow({mode:'open'}).innerHTML='<ul>'+product+'</ul>';
 const marker='let content = await searchWindow.webContents.mainFrame.executeJavaScript(';
 const begin=main.indexOf(marker,main.indexOf('async function renderedSearchSourceResult('))+marker.length;
 const end=main.indexOf('`, true).catch(error => {',begin);
 const code=runInNewContext(main.slice(begin,end+1),{...relay,articleNumber:'207521-001',source:{store:'브랜드 공식몰'},naverChannelCounts:null});
 const rendered=JSON.parse(dom.window.eval(code));assert.equal(rendered.productCards.length,1);
});
for(const code of ['207521-001黑色','206750-001黑色','JH9976白色']){
 test('existing outbound sanitizer strips Han metadata: '+code,()=>{
  assert.doesNotMatch(relay.sanitizeDomesticProductCode(code),/\p{Script=Han}/u);
  assert.equal(relay.sanitizeDomesticProductCode(code),code.replace(/\p{Script=Han}+/gu,''));
 });
}
function render(t,result,sourceProduct){
 const dom=page(t,'');dom.window.renderDomestic=()=>'';dom.window.renderExcelProductRows=()=>'';
 dom.window.eval(inline);return dom.window.renderDomestic(result,sourceProduct,'fixture');
}
test('the domestic result code is cleaned without changing the original workbook product',t=>{
 const raw={articleNumber:'207521-001黑色',title:'크록스 클래식 크러쉬 클로그 블랙'};
 const before=JSON.stringify(raw);
 const html=render(t,{products:[{store:'브랜드 공식몰',title:raw.title,url:productUrl,price:79000,articleNumber:raw.articleNumber}],sources:[{store:'브랜드 공식몰',officialStatus:'verified',searchUrl:pageUrl}]},raw);
 const dom=page(t,html);assert.equal(dom.window.document.querySelector('.domestic-inline-code').textContent,'207521-001');
 assert.equal(JSON.stringify(raw),before);
});
test('fallback result rows and manual official search carry a Han-free identity',t=>{
 const raw={articleNumber:'207521-001黑色'};
 const html=render(t,{products:[],sources:[{store:'브랜드 공식몰',officialStatus:'verified',searchQuery:raw.articleNumber,searchUrl:pageUrl}]},raw);
 const dom=page(t,html);assert.equal(dom.window.document.querySelector('.domestic-inline-code').textContent,'207521-001');
 assert.equal(decodeURIComponent(dom.window.document.querySelector('[data-official-query]').dataset.officialQuery),'207521-001');
 assert.equal(raw.articleNumber,'207521-001黑色');
});
