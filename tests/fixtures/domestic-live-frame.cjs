const {app, BrowserWindow, session} = require('electron');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {createContext, runInContext} = require('node:vm');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../..');
const wait = ms => new Promise(r => setTimeout(r, ms));
app.setPath('userData', process.env.AROUNDG_STOCK_TEST_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => {console.error('STOCK_RUNTIME_TIMEOUT');app.exit(1);}, 50_000);

app.whenReady().then(async () => {
  const relay = await import(pathToFileURL(resolve(root, 'relay/domestic-search.mjs')));
  const naver = await import(pathToFileURL(resolve(root, 'services/naver-fashiontown-result.mjs')));
  const source = readFileSync(resolve(root, 'main.mjs'), 'utf8');
  const context = createContext({...relay, ...naver, URL, setTimeout, clearTimeout, wait,
    domesticSearchGeneration:0, domesticSearchCanceled:()=>false});
  const section = (start,end) => source.slice(source.indexOf(start), source.indexOf(end,source.indexOf(start)));
  runInContext(section('async function openRenderedSizeOptions(', '\nfunction browserWindowUsable('), context);
  runInContext(section('async function waitForDomesticCaptureReady(', '\nasync function renderedSearchSourceResult('), context);
  const cases = [
    ['네이버 패션타운','https://shopping.naver.com/window/search/fashion-group?q=JH9976','https://shopping.naver.com/window-products/department/123',context.loadNaverFashionTownResultPage],
    ['무신사','https://www.musinsa.com/search/goods?keyword=JH9976&gf=A','https://www.musinsa.com/products/123',context.loadMusinsaResultPage],
  ];
  const collected = [];
  for (const [store,url,detail,loader] of cases) {
    const isolated = session.fromPartition('offline-stock-'+store);
    const releases = [];
    // All HTTPS requests, including the retailer URLs, are local fixtures.
    // Keep an image pending so Electron never emits did-stop-loading.
    isolated.protocol.handle('https', request => {
      if (request.url.includes('/hold.svg')) return new Promise(resolve => {
        releases.push(() => resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg"/>',{headers:{'content-type':'image/svg+xml'}})));
      });
      const body = request.url === detail
        ? '<h1>아디다스 JH9976</h1><p>99,000원</p><label>사이즈<select aria-label="사이즈"><option value="">사이즈 선택</option><option value="270">270 (3개 남음)</option><option value="280" disabled>280 (품절)</option></select></label><p>1인 최대 2개 구매</p><button>구매하기</button>'
        : '<p>전체 1개</p><a href="'+detail+'">아디다스 JH9976 99,000원</a>';
      return new Response('<!doctype html><meta charset="utf-8"><main>'+body+'</main><img src="https://offline.invalid/hold.svg">', {headers:{'content-type':'text/html;charset=utf-8'}});
    });
    const win = new BrowserWindow({show:false,width:1480,height:900,webPreferences:{session:isolated,sandbox:true,offscreen:true,backgroundThrottling:false,paintWhenInitiallyHidden:true}});
    try {
      const result = await loader(win,url,'JH9976');
      assert.equal(result.ok,true,store+' result DOM must be readable while image is pending');
      assert.equal(win.webContents.isLoadingMainFrame(),true);
      assert.equal(await context.clickRenderedProductCard(win,detail,url),true);
      assert.equal(win.webContents.getURL(),detail);
      const stock = await context.collectRenderedProductStock(win,store);
      assert.equal(win.webContents.isLoadingMainFrame(),true,'stock must arrive before full page load');
      assert.ok(stock.sizes.some(size => size.quantity===3 && /270/.test(size.label)),JSON.stringify(stock));
      assert.ok(stock.sizes.some(size => size.inStock===false && /280/.test(size.label)),JSON.stringify(stock));
      assert.ok(!stock.sizes.some(size => size.quantity===2),'purchase limit is not inventory');
      collected.push({store,title:'아디다스 JH9976',articleNumber:'JH9976',url:detail,price:99000,...stock});
      console.log(JSON.stringify({store,electron:process.versions.electron,offline:true,pendingImage:true,sizes:stock.sizes}));
    } finally {
      for (const release of releases) release();
      win.destroy();
      isolated.protocol.unhandle('https');
    }
  }
  // Pass the observations read by the real collector into the existing
  // product-search renderer. One normal search must place all retailer rows
  // below the selected product without a second inventory action.
  const fixture = await import(pathToFileURL(resolve(root,'tests/fixtures/domestic-completion-server.mjs')));
  const uiSession = session.fromPartition('offline-automatic-stock-list');
  uiSession.protocol.handle('https',request=>{
    const path=new URL(request.url).pathname;
    const allowed=['/src/style.css','/src/domestic-loading-overlay.css','/src/excel-column-layout.js',
      '/src/domestic-result-verdict.js','/src/sourcing-view.js','/src/domestic-inline-results.js'];
    const content=path==='/'?fixture.fixtureHtml:path==='/fixture.js'?fixture.fixtureScript:
      allowed.includes(path)?readFileSync(resolve(root,path.slice(1))):'';
    return new Response(content,{headers:{'content-type':path.endsWith('.js')?'text/javascript':
      path.endsWith('.css')?'text/css':'text/html;charset=utf-8'}});
  });
  const ui=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{session:uiSession,sandbox:true,offscreen:true,backgroundThrottling:false,paintWhenInitiallyHidden:true}});
  try {
    await ui.loadURL('https://offline.invalid/');
    const data={products:collected,sources:collected.map(p=>({store:p.store,count:1,countVerified:true}))};
    await ui.webContents.executeJavaScript(`
      product.articleNumber='JH9976';product.brandName='Adidas';product.title='아디다스 JH9976';
      window.automaticSearchCalls=0;
      window.aroundG.searchDomestic=async input=>{
        if(input.articleNumber!=='JH9976')throw Error('wrong search product');
        window.automaticSearchCalls++;
        return {ok:true,data:${JSON.stringify(data)}};
      };
      document.querySelector('#excel-preview-search-selected').click();
    `);
    let rendered;
    for(let i=0;i<30;i++) {
      await wait(100);
      rendered=await ui.webContents.executeJavaScript(`(()=>{
        const productRow=document.querySelector('.excel-verified-spu-row');
        const detail=productRow?.nextElementSibling;
        return {busy:excelPreviewBatchSearching,calls:window.automaticSearchCalls,
          below:Boolean(detail?.matches('.excel-verified-search-detail') && detail.getBoundingClientRect().top>=productRow.getBoundingClientRect().bottom),
          rows:[...document.querySelectorAll('.domestic-inline-row')].map(row=>({
            text:row.innerText,columns:row.children.length,stock:row.querySelector('.domestic-inline-stock-cell')?.innerText})),
          extraAction:Boolean(document.querySelector('[data-domestic-stock-refresh]')),
          errors:document.querySelector('#fixture-errors').textContent};
      })()`);
      if(!rendered.busy&&rendered.rows.length)break;
    }
    assert.equal(rendered.calls,1);
    assert.equal(rendered.below,true,'retailer list belongs directly below the product');
    assert.equal(rendered.extraAction,false,'no separate stock-fetch action');
    assert.equal(rendered.rows.length,2);
    for(const row of rendered.rows){assert.equal(row.columns,6);assert.match(row.stock,/270.*3개 남음/);assert.match(row.stock,/280.*품절/);assert.match(row.text,/99,000원/);}
    assert.equal(rendered.errors,'');
    console.log(JSON.stringify({automaticProductSearch:true,retailerRows:rendered.rows.length,belowProduct:true,extraStockClick:false,offline:true}));
  } finally {ui.destroy();uiSession.protocol.unhandle('https');}
  clearTimeout(watchdog);app.exit(0);
}).catch(error => {console.error(error.stack);clearTimeout(watchdog);app.exit(1);});
