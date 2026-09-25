import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {analyzeRenderedChannelProducts} from '../relay/domestic-search.mjs';
import {isOfficialProductCandidateUrl} from '../services/official-product-candidate.mjs';
import {captureRenderedStockEvidence, normalizeRenderedStockEvidence} from '../services/domestic-stock.mjs';

const code = 'SR123UTL11';
const card = (productUrl, title = '티프 긴팔 티셔츠') => ({productUrl,title,
  text:`${title} ${code} 49,000원`,price:'49,000원',imageUrl:'https://dk-on.com/shirt.jpg',imageLinkedToProduct:true});
test('official search and paging links cannot borrow a product code, image and price', () => {
  const real = card('https://dk-on.com/DESCENTE/product/12345');
  const cards = [card(`https://dk-on.com/DESCENTE/search?keyword=${code}`, `'${code}'에 대한 브랜드관 내 검색결과`),
    card(`https://dk-on.com/DESCENTE/search?keyword=${code}&pageSize=20`),
    card(`https://dk-on.com/shop/search?keyword=${code}`), real];
  const result = analyzeRenderedChannelProducts(JSON.stringify({productCards:cards}), '브랜드 공식몰',code,'데상트');
  assert.deepEqual(result.products.map(p=>p.url), [real.productUrl]);
});

test('Nike exact-code search excludes filters and other product styles', () => {
  const expected = 'CZ5478-001';
  const search = `https://www.nike.com/kr/w?q=${expected}&vst=${expected}`;
  const filter = `https://www.nike.com/kr/w?q=${expected}&vst=${expected}&category=men`;
  const unrelated = 'https://www.nike.com/kr/t/mind-001-BaaDLjpP/HQ4309-610';
  const matching = 'https://www.nike.com/kr/t/expected-style-123/CZ5478-001';
  const nestedMatching = 'https://www.nike.com/kr/t/expected-style/123abc/CZ5478-001';
  assert.equal(isOfficialProductCandidateUrl(filter, search, expected), false);
  assert.equal(isOfficialProductCandidateUrl(unrelated, search, expected), false);
  assert.equal(isOfficialProductCandidateUrl(matching, search, expected), true);
  assert.equal(isOfficialProductCandidateUrl(nestedMatching, search, expected), true);
  const candidate = (productUrl, title) => ({productUrl, title,
    text:`${title} ${expected} 119,000원`, price:'119,000원'});
  const content = productCards => JSON.stringify({pageText:`${expected} 검색 결과`,
    resolvedSearchUrl:search, productCards});
  const onlyNoise = analyzeRenderedChannelProducts(content([
    candidate(filter,'남성(으)로 필터링'), candidate(unrelated,'나이키 마인드 001'),
  ]), '브랜드 공식몰', expected, '나이키', '나이키 신발');
  assert.deepEqual(onlyNoise.products, []);
  assert.equal(onlyNoise.absenceConfirmed, false, 'unrelated links cannot prove product absence');
  const result = analyzeRenderedChannelProducts(content([
    candidate(filter,'남성(으)로 필터링'), candidate(unrelated,'나이키 마인드 001'),
    candidate(matching,'요청한 나이키 상품'),
  ]), '브랜드 공식몰', expected, '나이키', '나이키 신발');
  assert.deepEqual(result.products.map(product => product.url), [matching]);
});

test('utility controls are neither available nor sold-out sizes', () => {
  const result=normalizeRenderedStockEvidence({options:['공유하기','20개씩 보기','40개씩 보기','100개씩 보기','사이즈 비교'].map(label=>({label,inStock:false}))});
  assert.deepEqual(result.sizes,[]);
  assert.equal(result.inStock,null);
  const valid=normalizeRenderedStockEvidence({options:[{label:'100',inStock:true},{label:'블랙 / 105',inStock:false}]});
  assert.equal(valid.sizes.length,2);
  assert.equal(valid.inStock,true);
});

test('rendered option capture ignores utility buttons even under option classes', () => {
  const dom=new JSDOM('<main><div class="option"><button disabled>공유하기</button><button disabled>20개씩 보기</button><button>사이즈 비교</button><button>100</button></div></main>',{url:'https://dk-on.com/DESCENTE/product/12345',runScripts:'outside-only'});
  try {
    dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
    const evidence=dom.window.eval(`(${captureRenderedStockEvidence.toString()})(['.option button'])`);
    assert.deepEqual(Array.from(evidence.options,o=>o.label),['100']);
  } finally {dom.window.close();}
});
