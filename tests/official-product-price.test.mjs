import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {captureOfficialProductPrice} from '../services/official-product-price.mjs';
import {domesticProductUrlIdentity} from '../services/domestic-detail-page.mjs';
import {mergeRetailerStockProducts} from '../services/retailer-stock-strategies.mjs';

const code='SR313LCR71';
const url=`https://dk-on.com/DESCENTE/product/${code}/GRY0`;
// Minimal markup transcribed from the live official purchase panel, 2026-09-29.
const dk=(price=141550,color='GRY0')=>`<main><div class="page-title-wrap"><h2 id="prod-title">크론 레이서 / GRAY</h2><p class="prod-code">${code}</p></div>
<input type="radio" name="rdoProdColor1" value="${color}" checked>
<input type="radio" name="rdoProdColor2" value="${color}" checked>
<div class="prod-opt-select"><div class="opt-price" id="prod-price"><div class="opt-title">회원가</div>
<div class="prod-price" id="prod-price"><span class="percent">5%</span><span class="price-group"><span class="val">${price.toLocaleString('en-US')}</span><span class="unit">원</span></span>
<span class="price-group origin"><span class="val">149,000</span></span><span class="tooltip-box" style="display:none"><span>상품 할인 쿠폰 - 7,450원</span></span></div></div></div>
<aside class="recommend"><h3>다른 인기 상품</h3><span class="prod-price">49,000원</span></aside></main>`;
const generic=(prices,extras='')=>`<main><h1>크론 레이서 ${code}</h1>${prices}<button>장바구니 담기</button>${extras}</main>`;
function capture(html,{actualUrl=url,expectedUrl=actualUrl}={}) {
  const dom=new JSDOM(html,{url:actualUrl,runScripts:'outside-only'});
  try {
    dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
    return JSON.parse(JSON.stringify(dom.window.eval(`(${captureOfficialProductPrice.toString()})(${JSON.stringify(expectedUrl)},${JSON.stringify(code)},(${domesticProductUrlIdentity.toString()}))`)));
  } finally {dom.window.close();}
}
test('DK keeps the selected product member price, not recommendations, original price or coupon deduction',()=>{
  const result=capture(dk());
  assert.equal(result.price,141550); assert.equal(result.originalPrice,149000);
  assert.equal(result.priceVerified,true); assert.equal(result.priceBasis,'회원가');
  assert.equal(result.priceUrl,url);
});
test('DK keeps a genuinely cheaper color price without copying another color',()=>{
  assert.equal(capture(dk(99000)).price,99000);
  const other=`https://dk-on.com/DESCENTE/product/${code}/BLK0`;
  assert.equal(capture(dk(141550,'BLK0'),{actualUrl:other}).price,141550);
});
test('DK refuses a selection changed while the address stays on another color',()=>{
  const result=capture(dk(141550,'BLK0'));
  assert.equal(result.price,0); assert.equal(result.priceReason,'selected_color_mismatch');
});
test('DK waits for its own heading and price, even with an earlier cheap recommendation',()=>{
  for(const html of [dk().replace('크론 레이서 / GRAY',''),dk().replace('141,550',''),dk().replace('<div class="prod-opt-select">','<div class="prod-opt-select" hidden>')]) {
    assert.equal(capture(html).price,0);
  }
});
test('DK rejects conflicting mirrored prices and a different product code',()=>{
  assert.equal(capture(dk()+'<div id="prod-price" class="prod-price"><span class="price-group">129,000원</span></div>').price,0);
  assert.equal(capture(dk().replace('<p class="prod-code">'+code,'<p class="prod-code">OTHER')).price,0);
});
const genericUrl=`https://official.example/products/${code}`;
test('generic purchase panel excludes cheaper related goods, hidden prices, shipping and coupons',()=>{
  const html=generic('<span class="sale-price">141,550원</span><del class="original-price">149,000원</del>',
    '<section class="recommend"><span class="sale-price">49,000원</span></section><div style="display:none"><span class="sale-price">30,000원</span></div><div class="shipping"><span class="price">3,000원</span></div><span class="coupon"><span class="sale-price">7,450원</span></span>');
  assert.equal(capture(html,{actualUrl:genericUrl}).price,141550);
});
test('unclassified product cards linked to another product are not this purchase price',()=>{
  const html=generic('<span class="price">141,550원</span>','<li><a href="/products/OTHER">다른 상품</a><span class="price">49,000원</span></li>');
  assert.equal(capture(html,{actualUrl:genericUrl}).price,141550);
});
test('no visible owned price cannot be rescued by unrelated prices or structured data',()=>{
  const html=generic('','<aside class="recommend"><span class="price">49,000원</span></aside>')
    +`<script type="application/ld+json">${JSON.stringify({'@type':'Product',url:genericUrl,offers:{price:49000}})}</script>`;
  assert.equal(capture(html,{actualUrl:genericUrl}).price,0);
});
test('ambiguous purchase prices are not reduced to the cheapest number',()=>{
  assert.equal(capture(generic('<span class="price">141,550원</span><span class="price">49,000원</span>'),{actualUrl:genericUrl}).price,0);
});
test('matching pathname alone does not validate another product or color query',()=>{
  for(const expectedUrl of ['https://official.example/detail?goodsNo=1','https://official.example/detail?goodsNo=2&color=BLACK']) {
    const result=capture(generic('<span class="price">141,550원</span>'),{actualUrl:'https://official.example/detail?goodsNo=2&color=GRAY',expectedUrl});
    assert.equal(result.price,0); assert.equal(result.priceReason,'product_url_mismatch');
  }
});
test('verified detail prices survive a later raw card, but explicit new failures clear them',()=>{
  const product={store:'브랜드 공식몰',articleNumber:code,url,...capture(dk())};
  const card={store:product.store,articleNumber:code,url,price:49000};
  assert.equal(mergeRetailerStockProducts([product,card])[0].price,141550);
  const missing=capture(dk().replace('141,550',''));
  assert.equal(mergeRetailerStockProducts([product,{...card,...missing}])[0].price,0);
});
