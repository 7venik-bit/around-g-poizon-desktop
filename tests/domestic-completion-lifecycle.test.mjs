import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { fixtureHtml, fixtureScript, fixtureRoot } from "./fixtures/domestic-completion-server.mjs";

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise,resolve}; };
function createFixture(t) {
  const dom = new JSDOM(fixtureHtml.replace(/<script[\s\S]*?<\/script>/g, ""), {
    url: "http://offline.test", runScripts: "dangerously", pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
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
      failRendering: () => {
        const original = renderVerifiedSpuRows;
        renderVerifiedSpuRows = (...args) => {
          if (excelPreviewSearchResults.get(product._excelSelectionKey)?.products?.length) throw new Error('fixture result render failure');
          return original(...args);
        };
      },
      progress: (payload = {}) => progressCallback({completed:8,total:8,source:'이미지 교차검증',...payload}),
      raw: () => { activeExcelPreview.viewMode = 'raw'; },
    };
  `);
  return {window, api:window.fixture, run:() => click(),
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
