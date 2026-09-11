// Render the production retailer renderer/CSS with controlled data and no network.
const { app, BrowserWindow, session } = require('electron');
const { readFile, writeFile, mkdir, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '..'), out = join(root, 'layout-artifacts');
const fixture = join(root, 'src', '.domestic-stock-layout-fixture.html');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win;
const deadline = setTimeout(() => { console.error('Stock layout timed out'); app.exit(1); }, 60000);
const data = {
  products: [
    {store:'브랜드 공식몰',title:'여성 고어텍스 2L 방수재킷',articleNumber:'JKJGX25272',price:187200,url:'https://example.test/one',inStock:true,stockVerified:true,purchaseLimitText:'*ID당 구매 가능 수량 10개',sizes:[{label:'90',stockText:'90',inStock:true},{label:'95',stockText:'재고 3개',inStock:true},{label:'100 SOLD OUT',stockText:'100 SOLD OUT',inStock:false}]},
    {store:'코오롱몰',title:'남성 트레이닝 재킷',articleNumber:'JWJJM26321DGY',price:99000,url:'https://example.test/two',inStock:false,stockText:'현재 구매할 수 없는 상품입니다.\n품절'},
    {store:'무신사',title:'재킷',articleNumber:'EXAMPLE12345',price:89000,url:'https://example.test/three',inStock:null},
  ], sources:[{store:'SSG',verificationPending:true,searchUrl:'https://example.test/search'}],
};
function measure() {
  const list=document.querySelector('.domestic-inline-results');
  const headers=[...list.querySelector('.domestic-inline-head').children];
  const rows=[...list.querySelectorAll('.domestic-inline-row')];
  const errors=[];
  if(headers.length!==6 || headers[2].textContent!=='사이즈·재고') errors.push('stock heading missing');
  for(const row of rows) {
    if(row.children.length!==6) {errors.push('misaligned fallback row');continue;}
    [...row.children].forEach((cell,i)=>{
      const r=cell.getBoundingClientRect(), h=headers[i].getBoundingClientRect();
      if(Math.abs(r.x-h.x)>1 || Math.abs(r.width-h.width)>1) errors.push('column alignment '+i);
      if(r.right>list.getBoundingClientRect().right+1) errors.push('row overflow '+i);
      if(i===2 && cell.scrollWidth>cell.clientWidth+1) errors.push('stock text clipped');
    });
    for(const button of row.querySelectorAll('button')) if(button.scrollWidth>button.clientWidth+1) errors.push('button clipped');
  }
  const stock=rows[0].children[2];
  if(!/90.*선택 가능/.test(stock.textContent)||!/95.*재고 3개/.test(stock.textContent)||!/100 SOLD OUT/.test(stock.textContent)) errors.push('size omitted');
  if(!/구매 제한:/.test(stock.textContent)) errors.push('purchase limit conflated');
  if(rows[1].children[2].innerText.trim()!=='현재 구매할 수 없는 상품입니다.\n품절') errors.push('platform wording changed');
  if(rows[2].children[2].innerText.trim()!=='재고 확인 필요') errors.push('unknown stock invented');
  return {viewport:innerWidth,columns:getComputedStyle(rows[0]).gridTemplateColumns,errors};
}
async function cleanup(){clearTimeout(deadline);if(win&&!win.isDestroyed())win.destroy();await rm(fixture,{force:true});}
(async()=>{
  await app.whenReady();await mkdir(out,{recursive:true});
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  const source=await readFile(join(root,'src/domestic-inline-results.js'),'utf8');
  const html='<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="domestic-inline-results.css"><style>body{display:block;background:white;padding:24px}#stock-fixture{margin-left:220px;min-width:940px}</style><div id="stock-fixture"></div><script>let renderDomestic=()=>"";function stockWatchRegistrationButton(){return \'<button type="button" class="stock-watch-register-button">재고 감시 등록</button>\'}</script><script>'+source+'</script><script>document.getElementById("stock-fixture").innerHTML=renderDomestic('+JSON.stringify(data)+');</script>';
  await writeFile(fixture,html);
  win=new BrowserWindow({show:false,width:1426,height:900,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true,backgroundThrottling:false}});
  await win.loadFile(fixture);await win.webContents.executeJavaScript('document.fonts.ready');
  const results=[];
  for(const width of [980,1180,1426,1920]) for(const scale of [1,1.25]){
    win.setContentSize(width,900);win.webContents.setZoomFactor(scale);
    await new Promise(r=>setTimeout(r,40));
    results.push({width,scale,...await win.webContents.executeJavaScript('('+measure.toString()+')()')});
    if(width===1426&&scale===1)await writeFile(join(out,'domestic-stock-1426.png'),(await win.webContents.capturePage()).toPNG());
  }
  await writeFile(join(out,'stock-results.json'),JSON.stringify(results,null,2));
  const failed=results.filter(r=>r.errors.length);
  if(failed.length)throw new Error(JSON.stringify(failed));
  console.log('PASS: 8 rendered stock-column cases; sizes, exact stock wording, unknown state and action buttons.');
  await cleanup();app.exit(0);
})().catch(async e=>{console.error(e.stack||e);await cleanup();app.exit(1)});
