import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { fixtureHtml, fixtureScript, fixtureRoot } from "./fixtures/domestic-completion-server.mjs";

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise,resolve}; };
function createFixture(t) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
  const dom = new JSDOM(fixtureHtml.replace(/<script[\s\S]*?<\/script>/g, ""), {
    url: "http://offline.test", runScripts: "dangerously", pretendToBeVisual: true,
    virtualConsole,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  let click;
  const button = window.document.querySelector('#excel-preview-search-selected');
  const original = button.addEventListener.bind(button);
  button.addEventListener = (type, callback, ...args) => {
    if (type === 'click') click = callback;
    return original(type, callback, ...args);
  };
  const script = (code) => {
    const element = window.document.createElement('script');
    element.textContent = code;
    window.document.body.append(element);
  };
  script(fixtureScript);
  const rendererSource = readFileSync(resolve(fixtureRoot, 'src/renderer.js'), 'utf8');
  script(rendererSource.slice(rendererSource.indexOf('function domesticPriceCandidate('), rendererSource.indexOf('\nfunction renderProfitComparisons(')));
  for (const file of ['excel-column-layout.js', 'domestic-result-verdict.js', 'sourcing-view.js', 'domestic-inline-results.js']) {
    script(readFileSync(resolve(fixtureRoot, 'src', file), 'utf8'));
  }
  script(`
    renderExcelProductRows(activeExcelPreview.file, excelPreviewPageProducts);
    updateExcelPreviewSelectionUi(excelPreviewPageKeys);
    window.fixture = {
      result: () => excelPreviewSearchResults.get(product._excelSelectionKey),
      busy: () => excelPreviewBatchSearching,
      direct: () => searchExcelPreviewProduct(product._excelSelectionKey),
      search: () => cachedDomesticSearch(product),
      priceCandidate: (result) => domesticPriceCandidate(result),
      failRendering: () => {
        const original = renderVerifiedSpuRows;
        renderVerifiedSpuRows = (...args) => {
          if (excelPreviewSearchResults.get(product._excelSelectionKey)?.products?.length) throw new Error('fixture result render failure');
          return original(...args);
        };
      },
      progress: (payload = {}) => progressCallback({completed:8,total:8,source:'이미지 교차검증',...payload}),
      raw: () => { activeExcelPreview.viewMode = 'raw'; },
      selectTwo: () => {
        const second = {...product,articleNumber:'SR323UTS71',_excelSelectionKey:'second.xlsx::second'};
        excelPreviewPageProducts.push(second);
        excelPreviewPageKeys.push(second._excelSelectionKey);
        selectedExcelPreviewProducts.add(second._excelSelectionKey);
        excelPreviewProductCache.set(second._excelSelectionKey, second);
        activeExcelPreview.totalRows = 2;
      },
    };
  `);
  return {window, errors, api:window.fixture, run:() => click(),
    overlay:() => window.document.querySelector('#domestic-search-overlay'),
    status:() => window.document.querySelector('#excel-filter-status').textContent};
}

test('real enhanced renderer completes and places results beneath the selected product', async (t) => {
  const f = createFixture(t);
  await f.run();
  assert.equal(f.api.busy(), false);
  assert.equal(f.overlay().hidden, true);
  const row = f.window.document.querySelector('.excel-verified-spu-row');
  assert.ok(row.nextElementSibling.matches('.excel-verified-search-detail'));
  assert.match(row.nextElementSibling.textContent, /59,000원/);
  assert.equal(f.window.document.querySelector('#fixture-errors').textContent, '');
});

test('a timed-out search is never labeled complete', async t => {
  const f = createFixture(t);
  f.window.aroundG.searchDomestic = async () => ({ok:false,timedOut:true,message:'검색 응답 지연'});
  await f.run();
  const row = f.window.document.querySelector('.excel-verified-spu-row');
  assert.doesNotMatch(row.textContent, /검색 완료/);
  assert.match(row.textContent, /검색 실패/);
});

test('partial results retain prices below the product with an incomplete status', async t => {
  const f = createFixture(t);
  f.window.aroundG.searchDomestic = async () => ({ok:true,timedOut:true,data:{partial:true,message:'완료된 판매처 결과를 표시합니다.',products:[{store:'무신사',name:'데상트 테스트',price:84550,url:'https://www.musinsa.com/products/1'}],sources:[{store:'무신사',count:1,countVerified:true}]}});
  await f.run();
  const row = f.window.document.querySelector('.excel-verified-spu-row');
  assert.match(row.textContent, /일부 결과/);
  assert.match(row.nextElementSibling.textContent, /84,550원/);
  assert.match(row.nextElementSibling.textContent, /완료된 판매처/);
  assert.equal(f.overlay().hidden, true);
});

test('ongoing real progress keeps the frontend alive beyond its inactivity interval', async t => {
  const f = createFixture(t);
  f.window.aroundG.searchDomestic = async input => {
    for (let completed = 1; completed <= 3; completed++) {
      await tick(600);
      f.api.progress({completed,total:4,requestId:input.requestId});
    }
    return {ok:true,data:{products:[],sources:[]}};
  };
  const result = await f.api.search();
  assert.equal(result.ok, true);
});

test('100% source progress followed by a render exception releases the modal and retains the response', async (t) => {
  const f = createFixture(t);
  f.api.failRendering();
  let failure;
  await f.run().catch(error => { failure = error; });
  assert.equal(f.overlay().hidden, true, 'render failure must not trap the viewport');
  assert.equal(f.api.busy(), false);
  assert.equal(failure, undefined, 'click handler must own its rejection');
  assert.equal(f.api.result().products[0].price, 59000, 'do not lose completed search data');
  assert.match(f.status(), /표시|화면/);
});

test('stop is immediate even if cancellation IPC never replies; late success is ignored', async (t) => {
  const f = createFixture(t);
  const response = deferred();
  f.window.aroundG.searchDomestic = () => response.promise;
  f.window.aroundG.cancelDomesticSearch = () => new Promise(() => {});
  const run = f.run();
  await tick();
  void f.run();
  assert.equal(f.overlay().hidden, true, 'stop must not await cancellation IPC');
  response.resolve({ok:true,data:{products:[{price:999}],sources:[]}});
  await run;
  assert.notEqual(f.api.result()?.products?.[0]?.price, 999);
});

test('renderer deadline settles even if both search and cancellation IPC never reply', async (t) => {
  const f = createFixture(t);
  f.window.aroundG.searchDomestic = () => new Promise(() => {});
  f.window.aroundG.cancelDomesticSearch = () => new Promise(() => {});
  const result = await Promise.race([f.api.search(), tick(1800).then(() => 'still waiting')]);
  assert.equal(result?.timedOut, true);
});

test('source progress cannot claim overall 100% or another retailer after the last stage', async (t) => {
  const f = createFixture(t);
  const response = deferred();
  f.window.aroundG.searchDomestic = () => response.promise;
  const run = f.run();
  await tick();
  f.api.progress();
  assert.ok(f.overlay().querySelector('progress').value < 100);
  assert.doesNotMatch(f.overlay().querySelector('.domestic-overlay-guide').textContent, /다음 판매처/);
  response.resolve({ok:true,data:{products:[],sources:[]}});
  await run;
  assert.equal(f.overlay().hidden, true);
});

test('single-row search can be stopped by the actual overlay button without starting a batch', async (t) => {
  const f = createFixture(t);
  const response = deferred();
  let calls = 0;
  f.window.aroundG.searchDomestic = () => { ++calls; return response.promise; };
  f.window.aroundG.cancelDomesticSearch = () => new Promise(() => {});
  const run = f.api.direct();
  await tick();
  f.overlay().querySelector('.domestic-overlay-stop').click();
  assert.equal(f.overlay().hidden, true);
  response.resolve({ok:true,data:{products:[{price:999}],sources:[]}});
  await run;
  assert.equal(calls, 1);
  assert.notEqual(f.api.result()?.products?.[0]?.price, 999);
});

test('a canceled old request cannot close or overwrite a newer search', async (t) => {
  const f = createFixture(t);
  const old = deferred(), next = deferred();
  let calls = 0;
  f.window.aroundG.searchDomestic = () => ++calls === 1 ? old.promise : next.promise;
  const firstRun = f.run();
  await tick();
  await f.run(); // stop
  const secondRun = f.run();
  await tick();
  old.resolve({ok:true,data:{products:[{price:111}],sources:[]}});
  await firstRun;
  assert.equal(f.overlay().hidden, false);
  assert.equal(f.api.busy(), true);
  assert.equal(f.api.result().loading, true);
  next.resolve({ok:true,data:{products:[],sources:[]}});
  await secondRun;
  assert.equal(f.overlay().hidden, true);
});

test('raw Excel result refresh keeps existing rows and never reopens the workbook', async (t) => {
  const f = createFixture(t);
  f.api.raw();
  const row = f.window.document.querySelector('.excel-verified-spu-row');
  await f.run(); // showExcelPreview is a throwing stub: any call fails this test.
  assert.equal(f.window.document.querySelector('.excel-verified-spu-row'), row);
  assert.match(row.textContent, /상품 있음/);
  assert.equal(f.overlay().hidden, true);
  assert.match(f.status(), /완료/);
});

test('a progress event from a different request cannot mutate the active modal', async (t) => {
  const f = createFixture(t);
  const response = deferred();
  f.window.aroundG.searchDomestic = () => response.promise;
  const run = f.run();
  await tick();
  f.api.progress({requestId:'obsolete-request'});
  assert.equal(f.overlay().querySelector('progress').value, 0);
  response.resolve({ok:true,data:{products:[],sources:[]}});
  await run;
});

const officialSource = {
  store: '브랜드 공식몰', officialStatus: 'official',
  homepageUrl: 'https://official.example.com/',
  officialSearchUrl: 'https://official.example.com/search?q=SR123UPS11',
  searchQuery: 'SR123UPS11', resultLinkOnly: true,
};
for (const [name, officialProducts, source] of [
  ['official search link and Musinsa result', [], officialSource],
  ['official card without a detail URL', [{store:'브랜드 공식몰',name:'공식몰 데상트 상품',price:49000}], officialSource],
  ['confirmed absence with an official link', [], {...officialSource,count:0,countVerified:true,absenceConfirmed:true}],
]) {
  test(`${name} renders below the checked product with the correct result key`, async (t) => {
    const f = createFixture(t);
    f.window.aroundG.searchDomestic = async () => ({ok:true,data:{
      products:[...officialProducts,{store:'무신사',name:'데상트 상품',price:59000,url:'https://www.musinsa.com/products/123'}],
      sources:[source,{store:'무신사',count:1,countVerified:true}],
    }});
    await f.run();
    assert.deepEqual(f.errors, [], 'complete retailer payload must not throw during rendering');
    const row = f.window.document.querySelector('.excel-verified-spu-row');
    const detail = row.nextElementSibling;
    assert.ok(detail?.matches('.excel-verified-search-detail'), 'full-width result list must follow its product');
    assert.match(detail.textContent, /59,000원/);
    const official = detail.querySelector('[data-official-homepage]');
    assert.ok(official, 'official search link remains available');
    const key = decodeURIComponent(row.querySelector('[data-excel-product-select]').dataset.excelProductSelect);
    assert.equal(decodeURIComponent(official.dataset.officialResultKey), key);
    assert.equal(decodeURIComponent(official.dataset.officialQuery), 'SR123UPS11');
    assert.ok(detail.querySelector('[data-stock-register]'), 'Musinsa stock-watch action is preserved');
    assert.equal(f.overlay().hidden, true);
    assert.doesNotMatch(row.textContent, /검색 중/);
    if (source.absenceConfirmed) assert.match(detail.textContent, /상품 없음/);
  });
}

test('single-row mixed-source search preserves the direct official product URL', async (t) => {
  const f = createFixture(t);
  const url = 'https://official.example.com/products/SR123UPS11';
  f.window.aroundG.searchDomestic = async () => ({ok:true,data:{
    products:[{store:'브랜드 공식몰',name:'공식몰 데상트 상품',price:49000,url}],
    sources:[officialSource,{store:'네이버 패션타운',resultLinkOnly:true,searchUrl:'https://example.com/naver'}],
  }});
  await f.api.direct();
  assert.deepEqual(f.errors, []);
  const detail = f.window.document.querySelector('.excel-verified-search-detail');
  assert.match(detail.textContent, /49,000원/);
  const link = detail.querySelector('[data-url]');
  assert.equal(decodeURIComponent(link.dataset.url), url);
  assert.ok(detail.querySelector('[data-inline-naver-price]'));
  assert.equal(f.overlay().hidden, true);
});

test('multi-product six-retailer results retain each product key and list position', async (t) => {
  const f = createFixture(t);
  f.api.selectTwo();
  f.window.aroundG.searchDomestic = async (input) => ({ok:true,data:{
    products:[{store:'무신사',name:input.articleNumber,price:59000,url:'https://www.musinsa.com/products/123'}],
    sources:[
      {...officialSource,searchQuery:input.articleNumber},
      {store:'무신사',count:1,countVerified:true},
      {store:'네이버 패션타운',resultLinkOnly:true,searchUrl:'https://example.com/naver'},
      {store:'SSG',count:0,countVerified:true,searchUrl:'https://example.com/ssg'},
      {store:'롯데온',count:0,countVerified:true,searchUrl:'https://example.com/lotte'},
      {store:'코오롱몰',count:0,countVerified:true,searchUrl:'https://example.com/kolon'},
    ],
  }});
  await f.run();
  assert.deepEqual(f.errors, []);
  const rows = [...f.window.document.querySelectorAll('.excel-verified-spu-row')];
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const key = decodeURIComponent(row.querySelector('[data-excel-product-select]').dataset.excelProductSelect);
    const detail = row.nextElementSibling;
    assert.ok(detail.matches('.excel-verified-search-detail'));
    assert.equal(detail.querySelector('td').colSpan, 10);
    assert.equal(detail.querySelectorAll('.domestic-inline-row').length, 6);
    assert.equal(decodeURIComponent(detail.querySelector('[data-official-result-key]').dataset.officialResultKey), key);
    assert.equal(decodeURIComponent(detail.querySelector('[data-inline-naver-price]').dataset.inlineNaverPrice), key);
    assert.doesNotMatch(row.textContent, /검색 중/);
  }
  assert.equal(f.overlay().hidden, true);
  assert.match(f.status(), /2개 검색을 완료/);
});

for (const label of ['현재 구매할 수 없는 상품입니다.\n품절','SOLD OUT','재고 없음','솔드아웃']) {
  test(`the product lower list displays the platform stock wording: ${label}`, async t => {
    const f=createFixture(t);
    f.window.aroundG.searchDomestic=async()=>({ok:true,data:{products:[{store:'코오롱몰',title:'남성 트레이닝 재킷',price:99000,url:'https://www.kolonmall.com/Product/JWJJM26321DGY',inStock:false,stockText:label}],sources:[{store:'코오롱몰',count:1,countVerified:true}]}});
    await f.run();
    const row=f.window.document.querySelector('.excel-verified-spu-row');
    const detail=row.nextElementSibling;
    assert.equal(detail.querySelector('.domestic-inline-stock')?.textContent,label);
    assert.match(detail.textContent,/남성 트레이닝 재킷/);
    assert.doesNotMatch(detail.textContent,/상품 없음|재고 있음/);
    assert.equal(f.overlay().hidden,true);
  });
}
