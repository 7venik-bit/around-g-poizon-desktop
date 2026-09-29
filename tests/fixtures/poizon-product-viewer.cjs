// Exercise the production viewer with real Chromium pointer/keyboard events.
// All requests are locally fulfilled; no seller session, search or bid is sent.
const {app, BrowserWindow, session}=require('electron');
const {resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
app.setPath('userData',process.env.AROUNDG_STOCK_TEST_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const watchdog=setTimeout(()=>app.exit(1),45000);
const spu='25365760', article='SQ32JUTL81';
function page(scenario) {
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:20px;font:16px sans-serif}header{display:flex;gap:10px;align-items:center}
    .ant-select{position:relative}input{width:240px;padding:8px}button{padding:10px}
    #options{position:absolute;top:38px;background:white;border:1px solid gray;width:260px}
    td{padding:20px}.ant-drawer-content{padding:30px;border:1px solid}
    [hidden]{display:none!important}</style>
    <header><div class="ant-select">SPU_ID<input id="globalSpuIdList" readonly hidden></div>
    <div class="ant-select"><span id="tags"></span><input id="globalSpuIdList" autocomplete="off">
    <div id="options" role="listbox" hidden><div role="option">${spu}</div></div></div>
    <button id="search">검색 및 입찰</button></header>
    <table><tbody id="rows"></tbody></table><div class="ant-drawer-content" hidden></div>
    <script>
    const scenario=${JSON.stringify(scenario)},spu=${JSON.stringify(spu)},article=${JSON.stringify(article)};
    const field=document.querySelector('input:not([readonly])'),search=document.querySelector('#search');
    const options=document.querySelector('#options'),tags=document.querySelector('#tags'),rows=document.querySelector('#rows');
    document.body.dataset.searches='0';document.body.dataset.bids='0';document.body.dataset.enters='0';document.body.dataset.details='0';
    const count=key=>document.body.dataset[key]=Number(document.body.dataset[key])+1;
    function render(id,code){rows.innerHTML='<tr><td>상품 번호: '+code+'<br>SPU_ID：'+id+'</td><td><button class="bid">입찰 등록</button><button class="data">상품 데이터</button></td></tr>';
      rows.querySelector('.bid').onclick=()=>count('bids');
      rows.querySelector('.data').onclick=()=>{count('details');const drawer=document.querySelector('.ant-drawer-content');drawer.hidden=false;drawer.textContent=code+' 거래 추이 최근 30일';};}
    render(scenario==='already-visible'?spu:'17692658',scenario==='already-visible'?article:'JI0079');
    function commit(){if(field.value===spu){tags.innerHTML='<span class="ant-select-selection-item"><span class="ant-select-selection-item-content">'+spu+'</span></span>';field.value='';options.hidden=true;}}
    field.oninput=()=>{options.hidden=false;if(scenario==='committed')commit();
      if(scenario==='delayed-button'){search.disabled=true;setTimeout(()=>search.disabled=false,700);}};
    field.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();count('enters');commit();}};
    field.onblur=commit;
    search.onclick=()=>{count('searches');if((field.value||tags.textContent)!==spu)return;
      document.body.setAttribute('aria-busy','true');setTimeout(()=>{
        document.body.removeAttribute('aria-busy');
        if(scenario==='no-result'){rows.innerHTML='<tr><td>검색 결과 없음</td></tr>';return;}
        render(spu,article);
      },400);};
    </script>`;
}
app.whenReady().then(async()=>{
  const {createPoizonProductViewer}=await import(pathToFileURL(resolve(__dirname,'../../services/poizon-product-viewer.mjs')));
  const isolated=session.fromPartition('persist:around-g-poizon-seller');
  let scenario='',win;
  isolated.protocol.handle('https',request=>new Response(
    new URL(request.url).pathname==='/main/goods/search'?page(scenario):'',
    {headers:{'content-type':'text/html;charset=utf-8'}}));
  class FixtureWindow extends BrowserWindow {
    constructor(options){super({...options,show:false});win=this;}
  }
  try {
    for(scenario of ['autocomplete','committed','delayed-button','already-visible','no-result']) {
      const viewer=createPoizonProductViewer({BrowserWindow:FixtureWindow,timeoutMs:scenario==='no-result'?4000:7000});
      const result=await viewer.open({globalSpuId:spu});
      const counts=await win.webContents.executeJavaScript('({...document.body.dataset})');
      assert.equal(result.ok,scenario!=='no-result',JSON.stringify({scenario,result,counts}));
      if(scenario==='no-result')assert.equal(result.code,'PRODUCT_NOT_CONFIRMED');
      assert.equal(Number(counts.searches),scenario==='already-visible'?0:1,scenario+' submits once');
      assert.equal(Number(counts.details),scenario==='no-result'?0:1,scenario+' confirms exact drawer');
      assert.equal(Number(counts.bids),0,'bid registration must never be clicked');
      assert.equal(Number(counts.enters),0,'autocomplete Enter is not a search submission');
      console.log(JSON.stringify({scenario,ok:result.ok,spu,counts,offline:true}));
      win.destroy();
    }
  } finally {if(win&&!win.isDestroyed())win.destroy();isolated.protocol.unhandle('https');}
  clearTimeout(watchdog);app.exit(0);
}).catch(error=>{console.error(error.stack);clearTimeout(watchdog);app.exit(1);});
