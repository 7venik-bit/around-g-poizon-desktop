// Offline real-Chromium check of the serialized production collector.
// This is not a live retailer visit; every HTTPS request is locally fulfilled.
const {app, BrowserWindow, session}=require('electron');
const {resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
app.setPath('userData',process.env.AROUNDG_STOCK_TEST_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const watchdog=setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
  const root=resolve(__dirname,'../..');
  const {captureOfficialProductPrice}=await import(pathToFileURL(resolve(root,'services/official-product-price.mjs')));
  const {domesticProductUrlIdentity}=await import(pathToFileURL(resolve(root,'services/domestic-detail-page.mjs')));
  const url='https://dk-on.com/DESCENTE/product/SR313LCR71/GRY0';
  const isolated=session.fromPartition('offline-owned-price');
  isolated.protocol.handle('https',()=>new Response(`<!doctype html><meta charset="utf-8"><main>
    <div><h2 id="prod-title">크론 레이서 / GRAY</h2><p class="prod-code">SR313LCR71</p></div>
    <input type="radio" name="rdoProdColor1" value="GRY0" checked>
    <div class="opt-price" id="prod-price"><div class="opt-title">회원가</div>
    <div class="prod-price" id="prod-price"><span class="percent">5%</span>
    <span class="price-group"><span class="val">141,550</span><span class="unit">원</span></span>
    <span class="price-group origin"><span class="val">149,000</span></span>
    <span class="tooltip-box" hidden>할인액 <span>7,450원</span></span></div></div>
    <aside class="recommend"><span class="price">49,000원</span></aside></main>`,{headers:{'content-type':'text/html;charset=utf-8'}}));
  const win=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,backgroundThrottling:false}});
  try {
    await win.loadURL(url);
    const read=()=>win.webContents.executeJavaScript(`(${captureOfficialProductPrice.toString()})(${JSON.stringify(url)},'SR313LCR71',(${domesticProductUrlIdentity.toString()}))`);
    const result=await read();
    assert.equal(result.price,141550);assert.equal(result.originalPrice,149000);assert.equal(result.priceBasis,'회원가');
    await win.webContents.executeJavaScript(`document.querySelector('[id="prod-price"].prod-price > .price-group:not(.origin)').hidden=true`);
    assert.equal((await read()).price,0,'missing current price must not fall back to 49,000');
    await win.webContents.executeJavaScript(`document.querySelector('[id="prod-price"].prod-price > .price-group:not(.origin)').hidden=false;document.querySelector('input').value='BLK0'`);
    assert.equal((await read()).price,0,'color/address disagreement must remain unknown');
    console.log(JSON.stringify({officialPrice:141550,originalPrice:149000,recommendationIgnored:49000,missingPrice:0,colorMismatchPrice:0,offline:true}));
  } finally {win.destroy();isolated.protocol.unhandle('https');}
  clearTimeout(watchdog);app.exit(0);
}).catch(error=>{console.error(error.stack);clearTimeout(watchdog);app.exit(1);});
