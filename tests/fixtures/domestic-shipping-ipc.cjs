// Offline integration: production preload -> production IPC -> real retailer
// frames -> production card/identity/stock collectors. Only network and storage
// are fixtures; no search, matching, navigation or inventory function is stubbed.
const {app, BrowserWindow, ipcMain, session} = require('electron');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {createContext, runInContext} = require('node:vm');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../..');
const stalledDetails = process.argv.includes('--stalled-details');
app.setPath('userData', process.env.AROUNDG_STOCK_TEST_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
// The production collector intentionally observes each result for 25 seconds.
// Four sequential sources plus detail/option checks must fit without changing
// production timing merely to make the test pass quickly.
const watchdog = setTimeout(() => { console.error('SHIPPING_IPC_TIMEOUT'); app.exit(1); }, 210_000);

app.whenReady().then(async () => {
  const modules = {};
  for (const file of ['relay/domestic-search.mjs', 'services/naver-fashiontown-result.mjs',
    'services/matcher.mjs', 'services/domestic-recovery.mjs', 'services/brand-official-search.mjs',
    'services/official-mall-adapters.mjs', 'services/brand-integrity.mjs', 'services/naver-price.mjs',
    'services/domestic-detail-page.mjs', 'services/brand-search-profile.mjs', 'services/official-domain-registry.mjs']) {
    Object.assign(modules, await import(pathToFileURL(resolve(root, file))));
  }
  const allCases = [
    ['네이버 패션타운', 'shopping.naver.com', stalledDetails
      ? 'https://shopping.naver.com/window-products/department/123'
      : 'https://www.adidas.co.kr/ko/originals/JH9976.html'],
    ['무신사', 'www.musinsa.com', 'https://www.musinsa.com/products/123'],
    ['SSG', 'www.ssg.com', 'https://www.ssg.com/item/itemView.ssg?itemId=100'],
    ['롯데온', 'www.lotteon.com', 'https://www.lotteon.com/p/product/LO100'],
  ];
  const cases = stalledDetails ? allCases.filter(c => ['네이버 패션타운','롯데온'].includes(c[0])) : allCases;
  const retailers = session.fromPartition('offline-shipping-retailers');
  const releases = [], requests = [], windows = [];
  function htmlFor(rawUrl) {
    const url = new URL(rawUrl);
    const item = cases.find(c => c[1] === url.hostname || new URL(c[2]).hostname === url.hostname);
    assert.ok(item, `unexpected external destination: ${url.origin}`);
    if (stalledDetails && item[0] === '네이버 패션타운') {
      // Search cards exist, but every detail document stays unhydrated. Real
      // production deadlines must advance to Lotte instead of renewing on
      // each failed Naver visit. No production clock or timeout is shortened.
      if (url.pathname.startsWith('/window-products/')) return '<!doctype html><main>상품 정보를 불러오는 중</main>';
      return '<!doctype html><meta charset="utf-8"><main><p>전체 12개</p><ul>'
        + Array.from({length:12},(_,i) => '<li><a href="https://shopping.naver.com/window-products/department/' + (1000+i) + '">'
          + '<img width="160" height="160" src="https://offline.invalid/product.svg" alt="아디다스 JH9976">아디다스 오리지널스 JH9976 슈퍼스타</a>'
          + '<p>현대백화점</p><strong class="price">99,000원</strong></li>').join('') + '</ul></main>';
    }
    const detail = modules.domesticProductUrlIdentity(rawUrl) === modules.domesticProductUrlIdentity(item[2]);
    const optionMarkup = '<option value="270">270 (3개 남음)</option><option value="280" disabled>280 품절</option>';
    const body = detail
      ? '<h1>아디다스 오리지널스 JH9976 슈퍼스타</h1><p>현대백화점에서 판매하는 상품</p><p>99,000원</p>'
        + '<label>사이즈<select aria-label="사이즈"><option value="">사이즈 선택</option></select></label>'
        + '<p>1인 최대 2개 구매</p><button>구매하기</button>'
        + '<script>setTimeout(()=>document.querySelector("select").insertAdjacentHTML("beforeend",'
        + JSON.stringify(optionMarkup) + '),1800)</script>'
      : item[0] === '네이버 패션타운'
        // Supported external official-store cards need not repeat the query
        // outside the input or expose a total count. Detail identity is still
        // verified by the production collector, never inferred from readiness.
        ? '<input aria-label="검색" value="JH9976"><ul><li><a href="' + item[2] + '">'
          + '<img width="160" height="160" src="https://offline.invalid/product.svg" alt="아디다스 슈퍼스타">'
          + '아디다스 오리지널스 슈퍼스타</a><p>브랜드직영몰 본사직영</p><strong class="price">99,000원</strong></li></ul>'
        : '<p>전체 1개</p><ul><li><a href="' + item[2] + '"><img width="160" height="160" src="https://offline.invalid/product.svg" alt="아디다스 JH9976">'
          + '아디다스 오리지널스 JH9976 슈퍼스타</a><p>브랜드직영몰 본사직영 현대백화점</p><strong class="price">99,000원</strong></li></ul>';
    return '<!doctype html><meta charset="utf-8"><main>' + body + '</main><img src="https://offline.invalid/hold.svg">';
  }
  retailers.protocol.handle('https', request => {
    requests.push(request.url);
    if (request.url.endsWith('/hold.svg')) return new Promise(done => releases.push(() => done(new Response(''))));
    if (request.url.endsWith('/product.svg')) return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="white"/></svg>', {headers:{'content-type':'image/svg+xml'}});
    if (!stalledDetails && request.url === allCases[3][2]) {
      // Exercise real delayed navigation after the production physical click.
      // The previous fixed two-second URL snapshot failed before this document
      // could commit. Do not shorten production timings or stub navigation.
      return new Promise(done => setTimeout(() => done(new Response(htmlFor(request.url),
        {headers:{'content-type':'text/html;charset=utf-8'}})),5000));
    }
    return new Response(htmlFor(request.url), {headers:{'content-type':'text/html;charset=utf-8'}});
  });
  class RetailerWindow extends BrowserWindow {
    constructor(options) {
      super({...options, webPreferences:{...options.webPreferences, partition:undefined, session:retailers}});
      windows.push(this);
    }
  }
  const source = readFileSync(resolve(root, 'main.mjs'), 'utf8');
  const section = (start, end) => {
    const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `missing production section: ${start}`);
    return source.slice(from, to);
  };
  let settings = {};
  const context = createContext({...modules, URL, console, setTimeout, clearTimeout,
    wait:ms => new Promise(r => setTimeout(r, ms)), ipcMain, BrowserWindow:RetailerWindow,
    session:{fromPartition:() => retailers}, APP_ICON_PATH:undefined,
    DOMESTIC_SEARCH_PARTITION:'offline-shipping-retailers', DOMESTIC_SELLER_EVIDENCE_PARTITION:'offline-shipping-retailers',
    store:{data:{settings}, snapshot:() => ({settings}), setSettings:async patch => { settings = {...settings, ...patch}; }},
    imageFingerprint:async () => null,
    queryDomesticProducts:async input => {
      // Keep production query construction/parsing; fulfill HTTP locally.
      const result = await modules.queryDomesticProducts({...input, fetchImpl:async url => new Response(htmlFor(url))});
      // Exercise each integrated source once, independent of packaging's
      // presentation-only department/outlet row consolidation.
      return {...result, sources:result.sources.filter(s => cases.some(c => c[0] === s.store))};
    },
  });
  for (const [start,end] of [
    ['let domesticSearchGeneration = 0;', '\nconst DOMESTIC_LOGIN_SOURCES'],
    ['async function readNaverFashionTownChannelCounts(', '\nasync function ensureNaverOfficialBrandFilter('],
    ['async function openRenderedSizeOptions(', '\nfunction browserWindowUsable('],
    ['function browserWindowUsable(', '\nasync function loadOfficialPageForAutomation('],
    ['async function submitOfficialMallSearch(', '\nfunction renderedSearchFailure('],
    ['function renderedSearchFailure(', '\nasync function '],
    ['async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('],
    ['async function waitForDomesticCaptureReady(', '\nfunction brandsWithOfficialDomainStatus('],
    ['async function addMatchConfidence(', '\nasync function officialDetailImage('],
    ['async function officialDetailImage(', '\nfunction isNaverSecurityVerificationText('],
    ['async function resolveDomesticOfficialBrand(', '\nasync function persistOfficialDomainAudit('],
  ]) runInContext(section(start,end), context);
  // A historical alternate route must never be silently absent in this test.
  if (source.includes('async function september10AddMatchConfidence(')) {
    runInContext(section('async function september10AddMatchConfidence(', '\nlet store;'), context);
  }
  runInContext(section('  ipcMain.handle("domestic:search"', '  ipcMain.handle("domestic:recovery-start"'), context);
  console.log(JSON.stringify({productionIpc:'registered', offline:true}));
  const client = new BrowserWindow({show:false, webPreferences:{preload:resolve(root,'preload.cjs'), sandbox:true, offscreen:true, backgroundThrottling:false, paintWhenInitiallyHidden:true}});
  try {
    await client.loadURL('data:text/html,<html><body>Offline IPC verification</body></html>');
    console.log(JSON.stringify({productionPreload:'ready', offline:true}));
    const startedAt = Date.now();
    const result = await client.webContents.executeJavaScript(`window.aroundG.searchDomestic({
      query:'JH9976',articleNumber:'JH9976',brand:'Adidas Originals',title:'슈퍼스타',
      sourceGroups:${JSON.stringify(stalledDetails ? ['naver','lotte'] : ['naver','musinsa','ssg','lotte'])},verifyLinkCounts:true,requestId:'shipping-fixture'
    })`);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.data.technicalWarnings, [], JSON.stringify(result.data.technicalWarnings));
    assert.equal(result.data.sources.length, cases.length);
    if (stalledDetails) {
      const failed = result.data.sources.find(s => s.store === '네이버 패션타운');
      assert.equal(failed.verificationReason, 'collection_stalled', JSON.stringify(failed));
      assert.equal(failed.absenceConfirmed, false);
      assert.ok(failed.verificationDiagnostics.failedDetails > 0);
      assert.equal(failed.verificationDiagnostics.totalProducts, 12);
      const detailRequests = requests.filter(url => url.includes('/window-products/')).length;
      assert.ok(detailRequests > 0 && detailRequests < 12, `opened ${detailRequests} stalled detail pages`);
      assert.ok(Date.now() - startedAt < 170_000, 'failed detail visits must not renew the inactivity timeout');
      const retained = result.data.products.find(p => p.store === '네이버 패션타운');
      assert.equal(retained?.price, 99000, 'retain the observed search-card price');
      assert.equal(retained.stockVerified, false, 'an unreadable stock page is not verified stock');
      console.log(JSON.stringify({productionStallRecovery:true, detailRequests, elapsedMs:Date.now()-startedAt, offline:true}));
    }
    for (const [store,,url] of cases.filter(c => !stalledDetails || c[0] !== '네이버 패션타운')) {
      const product = result.data.products.find(p => modules.domesticProductUrlIdentity(p.url) === modules.domesticProductUrlIdentity(url));
      assert.ok(product, JSON.stringify({store, sources:result.data.sources, products:result.data.products}));
      assert.equal(product.price, 99000);
      assert.ok(product.sizes.some(s => /270/.test(s.label) && s.quantity === 3), JSON.stringify(product));
      assert.ok(product.sizes.some(s => /280/.test(s.label) && s.inStock === false), JSON.stringify(product));
      assert.ok(!product.sizes.some(s => s.quantity === 2), 'purchase limit is not inventory');
      console.log(JSON.stringify({productionPreload:true, productionIpc:true, store, price:product.price, sizes:product.sizes, offline:true}));
    }
    assert.equal(result.data.partial, stalledDetails, JSON.stringify({sources:result.data.sources, products:result.data.products}));
    assert.ok(requests.some(url => url.includes('/hold.svg')));
    assert.ok(windows.length >= cases.length, 'search must use real retailer frames');
    console.log(JSON.stringify({productionSearchComplete:true, retailers:cases.length, partial:stalledDetails, offline:true}));
  } finally {
    for (const release of releases) release();
    for (const win of windows) if (!win.isDestroyed()) win.destroy();
    client.destroy();
    retailers.protocol.unhandle('https');
  }
  clearTimeout(watchdog);
  app.exit(0);
}).catch(error => {console.error(error?.stack || error);clearTimeout(watchdog);app.exit(1);});
