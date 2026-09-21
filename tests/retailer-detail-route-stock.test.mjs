import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {isOfficialProductCandidateUrl} from '../services/official-product-candidate.mjs';
import {analyzeRenderedChannelProducts} from '../relay/domestic-search.mjs';
import {captureNativeStockControls, collectNativeStockVariants, retailerStockStrategy} from '../services/retailer-stock-strategies.mjs';
import {captureRenderedStockEvidence, normalizeRenderedStockEvidence} from '../services/domestic-stock.mjs';

const code = 'SR123UPS11';
const official = `https://dk-on.com/DESCENTE/product/${code}/WHT0`;
function page(t, html, url = official) {
  const dom = new JSDOM(html, {url, runScripts:'outside-only'});
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {get(){return this.textContent;}});
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({width:100,height:30});
  t.after(() => dom.window.close());
  return dom;
}
const readControls = dom => dom.window.eval(`(${captureNativeStockControls.toString()})()`);

test('DK search navigation never borrows an exact article, image and price from the result page', () => {
  const navigation = ['/', '/DESCENTE', '/DESCENTE/BEST', '/DESCENTE/newArrival', '/DESCENTE/OUTLET/category/201000000', '/event/detail/231600', '/cs/notice/detail/24394', '/serviceGuide/storeInfo'];
  for (const path of navigation) assert.equal(isOfficialProductCandidateUrl(`https://dk-on.com${path}`), false, path);
  const products = [official, official.replace('WHT0','BLK0')];
  const productCards = [...navigation.map(path=>`https://dk-on.com${path}`), ...products].map(productUrl=>({
    productUrl, title:`데상트 터프 폴로 반팔 티셔츠 ${code}`, text:`${code} 80,100원`, price:'80,100원', imageUrl:'https://dk-on.com/shirt.jpg', imageLinkedToProduct:true,
  }));
  const result = analyzeRenderedChannelProducts(JSON.stringify({productCards}), '브랜드 공식몰', code, '데상트');
  assert.deepEqual(result.products.map(product=>product.url), products);
  assert.equal(isOfficialProductCandidateUrl('https://dk-on.com/DESCENTE/product/12345'), true);
  assert.equal(isOfficialProductCandidateUrl('https://dk-on.com/DESCENTE/goods/detail/12345'), true);
  assert.equal(isOfficialProductCandidateUrl('https://www.ssg.com/item/itemView.ssg?itemId=123'), true);
});

// Sanitized structure observed on the live DK product on 2026-09-21. These
// synthetic quantities test extraction, not current availability of a fixture.
const dkSize = (size, attributes = '', group = 1) => `<span class="ui-size-rdo"><input type="radio" id="s${group}-${size}" name="rdoProdSize${group}" data-prod-cd="${code}" data-color-cd="WHT0" data-size-cd="${size}" ${attributes}><label for="s${group}-${size}">${size}</label></span>`;
test('DK explicit option stock quantities survive native traversal and normalization', async t => {
  const dom = page(t, `<ul id="prod-size-1">${dkSize(105,'data-stock-qty="0" disabled')}${dkSize(110,'data-stock-qty="3" data-gift-psbl-qty="0"')}${dkSize(115,'data-max-order-qty="9"')}</ul>`);
  const result = await collectNativeStockVariants({read:async()=>readControls(dom),select:async()=>assert.fail('leaf sizes need no click'),settle:async()=>{}});
  const stock = normalizeRenderedStockEvidence({options:result.options});
  assert.deepEqual(stock.sizes.map(size=>[size.label,size.inStock,size.quantity]), [['105',false,0],['110',true,3],['115',true,undefined]]);
});

test('rendered DK stock keeps explicit quantities and does not substitute purchase limits', t => {
  const dom = page(t, `<main><h1>터프 폴로 ${code}</h1>${dkSize(105,'data-stock-qty="0" disabled')}${dkSize(110,'data-stock-qty="3"')}${dkSize(115,'data-max-order-qty="9"')}</main>`);
  const selectors = retailerStockStrategy({url:official}).optionSelectors;
  const captured = dom.window.eval(`(${captureRenderedStockEvidence.toString()})(${JSON.stringify(selectors)})`);
  const stock = normalizeRenderedStockEvidence(captured);
  assert.deepEqual(stock.sizes.map(size=>size.quantity), [0,3,undefined]);
});

test('invalid option quantity is unknown while an explicit zero overrides an enabled control', t => {
  const values = ['', '-1', '1.5', 'unknown', '9007199254740992', '0', '1,200'];
  const dom = page(t, values.map((value,index)=>dkSize(85+index,`data-stock-qty="${value}" data-max-order-qty="3"`)).join(''));
  const options = readControls(dom).groups[0].options;
  assert.deepEqual(Array.from(options,option=>option.quantity), [undefined,undefined,undefined,undefined,undefined,0,1200]);
  assert.equal(options[5].inStock, false);
});

// Naver renders the same colour/size dropdowns in its upper and sticky purchase
// panels. data-shp-contents-type is stable after selecting a colour or size.
const naverControl = (type, value, options) => `<div><a href="#" role="button" aria-haspopup="listbox" aria-expanded="true" data-shp-page-key="100393376" data-shp-area-id="optselect" data-shp-contents-type="${type}">${value}</a><ul role="listbox">${options.map(label=>`<li><a href="#" role="option">${label}</a></li>`).join('')}</ul></div>`;
test('Naver mirrored purchase panels are one colour and size dimension after selection', async t => {
  const panel = naverControl('색상','BLK0_BLACK',['BLK0_BLACK','WHT0_WHITE']) + naverControl('사이즈','110',['110','115 품절']);
  const dom = page(t, `<main>${panel}${panel}</main>`, 'https://shopping.naver.com/window-products/brandfashion/12842936435');
  const state = readControls(dom);
  assert.deepEqual(Array.from(state.groups, group=>group.label), ['색상','사이즈']);
  let selections = 0;
  const result = await collectNativeStockVariants({read:async()=>readControls(dom),select:async()=>{selections++;},settle:async()=>{}});
  assert.equal(result.complete,true);
  assert.equal(selections,2);
  assert.deepEqual(result.options.map(option=>option.label), ['BLK0_BLACK / 110','BLK0_BLACK / 115 품절','WHT0_WHITE / 110','WHT0_WHITE / 115 품절']);
});

test('similarly named non-Naver custom option groups are not merged', t => {
  const dom = page(t, `<main>${naverControl('색상','색상',['블랙'])}${naverControl('색상','색상',['화이트'])}</main>`, 'https://merchant.example/product/1');
  assert.equal(readControls(dom).groups.length, 2);
});
