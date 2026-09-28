import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {mergeRetailerStockProducts} from '../services/retailer-stock-strategies.mjs';
import {mergeDomesticCheckpoint} from '../services/domestic-recovery.mjs';
import {readableColorName} from '../services/retailer-color-names.mjs';

const article = 'SR323UTL71';
const official = (code = 'CHC0', extra = {}) => ({store:'브랜드 공식몰', articleNumber:article,
  title:'터프 긴팔 티셔츠', url:`https://dk-on.com/DESCENTE/product/${article}/${code}`,
  price:65550, sizes:[{label:'95', inStock:true, quantity:5}, {label:'100', inStock:false, quantity:0}], ...extra});
const peer = (label = 'CHC0_CHARCOAL-GREY', extra = {}) => ({store:'무신사', articleNumber:article,
  title:`데상트 터프 긴팔 티셔츠 차콜 그레이 ${article}`, url:'https://www.musinsa.com/products/1234',
  sizes:[{label:`${label} / 95`, optionPath:[label,'95'], inStock:false, stockText:'품절 재입고 알림'}], ...extra});

test('same model and colour borrow the observed Musinsa name, never its inventory or price', () => {
  const inputs = [official(), peer()];
  const before = structuredClone(inputs);
  const [result, donor] = mergeRetailerStockProducts(inputs);
  assert.equal(result.colorName, '차콜 그레이');
  assert.equal(result.title, '터프 긴팔 티셔츠 [차콜 그레이]');
  assert.deepEqual(result.sizes.map(s => [s.label,s.inStock,s.quantity]), [['차콜 그레이 / 95',true,5],['차콜 그레이 / 100',false,0]]);
  assert.equal(result.url, inputs[0].url);
  assert.equal(result.price, 65550);
  assert.equal(result.colorNameSource.kind, 'retailer');
  assert.equal(result.colorNameSource.url, inputs[1].url);
  assert.equal(result.colorNameSource.rawName, 'CHC0_CHARCOAL-GREY');
  assert.deepEqual(donor, {...before[1], inStock:false});
  assert.deepEqual(inputs, before);
  assert.deepEqual(mergeRetailerStockProducts([inputs[1],inputs[0]])[1], result);
});

test('Naver fills another missing colour using product-owned article evidence', () => {
  const donor = peer('LGR0_LIGHT-GREY', {store:'네이버 패션타운', title:'데상트 티셔츠',
    detectedArticleNumber:article, url:'https://shopping.naver.com/window-products/brandfashion/123'});
  assert.equal(mergeRetailerStockProducts([official('LGR0'), donor])[0].colorName, '라이트 그레이');
});

test('all colours are compared independently and no variants or stock quantities merge', () => {
  const result = mergeRetailerStockProducts([official('BLK0'),official('WHT0'),official('LGR0'),official('DNVY'),
    peer('LGR0_LIGHT-GREY'),peer('DNVY_DARK-NAVY',{url:'https://www.musinsa.com/products/5678'})]);
  assert.deepEqual(result.slice(0,4).map(p => p.colorName), ['블랙','화이트','라이트 그레이','다크 네이비']);
  assert.equal(result.length,6);
  assert.ok(result.slice(0,4).every(p => p.sizes.length === 2 && p.sizes[0].quantity === 5));
});

test('query article alone, another model, brand, host, colour and rejected candidates cannot supply a name', () => {
  const invalid = [
    peer('LGR0_LIGHT-GREY',{title:'데상트 티셔츠'}),
    peer('LGR0_LIGHT-GREY',{title:'데상트 SR323UTL72'}),
    peer('LGR0_LIGHT-GREY',{detectedArticleNumber:'SR323UTL72'}),
    peer('LGR0_LIGHT-GREY',{title:`나이키 ${article}`}),
    peer('LGR0_LIGHT-GREY',{url:'https://musinsa.com.example.test/products/1'}),
    peer('OTHER_LIGHT-GREY'),
    peer('LGR0_LIGHT-GREY',{articleConflict:true}),
    peer('LGR0_LIGHT-GREY',{signals:{codeConflict:true}}),
    peer('LGR0_LIGHT-GREY',{musinsaImageRejected:true}),
  ];
  for (const donor of invalid) assert.equal(mergeRetailerStockProducts([official('LGR0'),donor])[0].colorName,'LGR0');
});

test('conflicting names leave an unknown code untouched; equivalent English and Korean names agree', () => {
  const one = peer('LGR0_LIGHT-GREY');
  const two = peer('LGR0_DARK-GREY',{url:'https://brand.naver.com/descente/products/987'});
  assert.equal(mergeRetailerStockProducts([official('LGR0'),one,two])[0].colorName,'LGR0');
  two.sizes = [{label:'LGR0_라이트 그레이 / 95'}];
  assert.equal(mergeRetailerStockProducts([official('LGR0'),one,two])[0].colorName,'라이트 그레이');
});

test('already known colour and code-bound official evidence take priority over peer labels', () => {
  const named = official('LGR0',{colorCode:'LGR0',colorName:'멜란지 그레이'});
  assert.equal(mergeRetailerStockProducts([named,peer('LGR0_LIGHT-GREY')])[0].colorName,'멜란지 그레이');
  const coded = official('LGR0',{sizes:[{label:'LGR0_MELANGE-GREY / 95',inStock:true}]});
  const [result] = mergeRetailerStockProducts([coded,peer('LGR0_LIGHT-GREY')]);
  assert.equal(result.colorName,'멜란지 그레이');
  assert.equal(result.colorNameSource.kind,'official');
  assert.equal(result.sizes[0].label,'멜란지 그레이 / 95');
});

test('a changed title without a bound colour code does not rename a URL colour', () => {
  assert.equal(mergeRetailerStockProducts([official('LGR0',{title:'터프 긴팔 / BLACK'})])[0].colorName,'LGR0');
});

test('a late peer result replaces old placeholder suffix and path once across checkpoints', () => {
  const [placeholder] = mergeRetailerStockProducts([official('LGR0')]);
  const merged = mergeDomesticCheckpoint({products:[placeholder]}, {products:[peer('LGR0_LIGHT-GREY')]});
  assert.equal(merged.products[0].title,'터프 긴팔 티셔츠 [라이트 그레이]');
  assert.equal(merged.products[0].sizes[0].label,'라이트 그레이 / 95');
  assert.deepEqual(mergeRetailerStockProducts(merged.products), merged.products);
  const refreshed = mergeDomesticCheckpoint(merged,{products:[official('LGR0')]});
  assert.equal(refreshed.products[0].sizes.length,2);
  assert.equal(refreshed.products[0].colorName,'라이트 그레이');
});

test('confirmed charcoal remains readable when peer sites are disabled and unknown codes stay visible', () => {
  assert.equal(mergeRetailerStockProducts([official()])[0].colorName,'차콜 그레이');
  assert.equal(mergeRetailerStockProducts([official('ZZZ9')])[0].colorName,'ZZZ9');
  assert.equal(readableColorName('CHARCOAL-GRAY'),'차콜 그레이');
  assert.equal(readableColorName('CHC0'),'');
  assert.equal(readableColorName('OFF_WHITE'),'오프화이트');
});

test('fresh official stock preserves an earlier name without needing the peer to be present again', () => {
  const [saved] = mergeRetailerStockProducts([official('LGR0'),peer('LGR0_LIGHT-GREY')]);
  const fresh = official('LGR0',{sizes:[{label:'95',quantity:2,inStock:true},{label:'100',quantity:1,inStock:true}]});
  for (const input of [[saved,fresh],[fresh,saved]]) {
    const [result] = mergeRetailerStockProducts(input);
    assert.equal(result.colorName,'라이트 그레이');
    assert.equal(result.title,'터프 긴팔 티셔츠 [라이트 그레이]');
    assert.equal(result.sizes.length,2);
    assert.ok(result.sizes.every(s => s.label.startsWith('라이트 그레이 / ')));
  }
  const [result] = mergeRetailerStockProducts([saved,fresh]);
  assert.deepEqual(result.sizes.map(s => s.quantity),[2,1]);
  assert.equal(result.colorNameSource.url,peer().url);
});

test('an incomplete colour-only option terminates without inventing a size or quantity', () => {
  const [result] = mergeRetailerStockProducts([official('CHC0',{sizes:[{label:'CHC0',optionPath:['CHC0'],inStock:null}]})]);
  assert.equal(result.sizes[0].label,'차콜 그레이');
  assert.deepEqual(result.sizes[0].optionPath,['차콜 그레이']);
  assert.equal(result.sizes[0].inStock,null);
  assert.equal(result.sizes[0].quantity,undefined);
});

test('the production result renderer displays the added name and keeps the official stock link', t => {
  const dom = new JSDOM('<body><main></main>', {runScripts:'outside-only'});
  t.after(() => dom.window.close());
  dom.window.renderDomestic = () => '';
  dom.window.eval(readFileSync(new URL('../src/domestic-inline-results.js',import.meta.url),'utf8'));
  const products = mergeRetailerStockProducts([official(),peer()]);
  dom.window.document.querySelector('main').innerHTML = dom.window.renderDomestic({products,sources:[]});
  const row = dom.window.document.querySelector('.domestic-inline-row');
  assert.match(row.textContent,/터프 긴팔 티셔츠 \[차콜 그레이\]/);
  assert.match(row.textContent,/차콜 그레이 \/ 95 · 재고 5개/);
  assert.match(row.textContent,/차콜 그레이 \/ 100 · 재고 0개/);
  const link = row.querySelector('.domestic-inline-actions [data-url]');
  assert.equal(decodeURIComponent(link.dataset.url),official().url);
});
