import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  captureVisibleExactRetailerCards,
  visibleRetailerCardsToProducts,
  officialSearchErrorText,
} from '../services/live-retailer-card-fallback.mjs';

function run(html, {url, article, store}) {
  const dom = new JSDOM(`<body>${html}</body>`, {url, runScripts:'outside-only', pretendToBeVisual:true});
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { configurable:true, get(){ return this.textContent; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({width:180,height:80});
  const capture = dom.window.eval(`(${captureVisibleExactRetailerCards.toString()})(${JSON.stringify(article)},${JSON.stringify(store)})`);
  dom.window.close();
  return capture;
}

test('Naver exact model card preserves the displayed sale price without inventing stock', () => {
  const capture = run(`
    <article><span>토박스</span><span>백화점</span><a href="https://shopping.naver.com/window-products/department/13723710333"></a>
    <p>아디다스 운동화 화이트블랙 슈퍼스타 II J ADYCG1TSSU13WBK(JH9976)</p>
    <p>할인 전 판매가 119,000원 할인율 15% 101,150원 무료배송</p></article>`, {
      url:'https://shopping.naver.com/window/search/fashion-group?q=JH9976', article:'JH9976', store:'네이버 패션타운',
    });
  const products = visibleRetailerCardsToProducts(capture,{store:'네이버 패션타운',articleNumber:'JH9976',brand:'아디다스'});
  assert.equal(products.length,1);
  assert.equal(products[0].price,101150);
  assert.equal(products[0].articleNumberVerified,true);
  assert.equal(products[0].inStock,null);
  assert.equal(products[0].stockVerified,false);
});

test('LotteON exact card uses 최종가 and accepts hyphen/space-equivalent article text', () => {
  const capture = run(`
    <article><a href="https://www.lotteon.com/p/product/LO2124578791"></a><strong>크록스</strong>
    <p>크러쉬 클로그 블랙 207521 001</p><p>정상가 79,100 할인율 23% 최종가 60,120 무료배송</p></article>`, {
      url:'https://www.lotteon.com/csearch/search/search?q=207521-001', article:'207521-001', store:'롯데온',
    });
  const products=visibleRetailerCardsToProducts(capture,{store:'롯데온',articleNumber:'207521-001',brand:'크록스'});
  assert.equal(products.length,1);
  assert.equal(products[0].price,60120);
  assert.match(products[0].url,/lotteon\.com\/p\/product/);
});

test('overseas/parallel wording is not recovered as a domestic exact card', () => {
  const capture = run(`<article><a href="https://www.lotteon.com/p/product/LO1"></a><p>해외직구 병행수입 크록스 207521-001</p><p>최종가 50,000</p></article>`,{
    url:'https://www.lotteon.com/csearch/search/search?q=207521-001',article:'207521-001',store:'롯데온'});
  assert.equal(visibleRetailerCardsToProducts(capture,{store:'롯데온',articleNumber:'207521-001',brand:'크록스'}).length,0);
});

test('official 404 page and skip link can never become a product', () => {
  const capture = run(`<main><a href="https://www.crocs.co.kr/search?q=207521-001">메인 컨텐츠로 건너뛰기</a><h1>페이지를 찾을 수 없습니다</h1><p>207521-001 69,900원</p></main>`,{
    url:'https://www.crocs.co.kr/search?q=207521-001',article:'207521-001',store:'브랜드 공식몰'});
  assert.equal(officialSearchErrorText(capture.pageText),true);
  assert.equal(visibleRetailerCardsToProducts(capture,{store:'브랜드 공식몰',articleNumber:'207521-001',brand:'크록스'}).length,0);
});

test('official style page may retain a base-style product link while leaving exact colour verification false', () => {
  const capture = run(`<article><a href="https://www.crocs.co.kr/p/crush-clog/207521.html"></a><h2>크러쉬 클로그 207521</h2><p>₩69,900</p></article>`,{
    url:'https://www.crocs.co.kr/',article:'207521-001',store:'브랜드 공식몰'});
  const products=visibleRetailerCardsToProducts(capture,{store:'브랜드 공식몰',articleNumber:'207521-001',brand:'크록스'});
  assert.equal(products.length,1);
  assert.equal(products[0].price,69900);
  assert.equal(products[0].articleNumberVerified,false);
  assert.equal(products[0].matchBasis,'official_style');
});
