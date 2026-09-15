// Render the production retailer renderer/CSS under the production CSP.
// Fixtures are offline; they do not claim live retailer or user-PC validation.
const { app, BrowserWindow, session } = require('electron');
const { readFile, writeFile, mkdir, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '..'), out = join(root, 'layout-artifacts');
const fixture = join(root, 'src', '.domestic-stock-layout-fixture.html');
const fixtureStyle = join(root, 'src', '.domestic-stock-layout-fixture.css');
const fixtureBootstrap = join(root, 'src', '.domestic-stock-layout-bootstrap.js');
const fixtureRender = join(root, 'src', '.domestic-stock-layout-render.js');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win;
const deadline = setTimeout(() => { console.error('Stock layout timed out'); app.exit(1); }, 60000);
const availableShoeSizes = new Set([220,225,230,235,240,245,255,285]);
const data = {
  products: [
    {store:'브랜드 공식몰',title:'여성 고어텍스 2L 방수재킷',articleNumber:'JKJGX25272',price:187200,url:'https://example.test/one',inStock:true,stockVerified:true,purchaseLimitText:'*ID당 구매 가능 수량 10개',sizes:[{label:'90',stockText:'90',inStock:true},{label:'95',stockText:'재고 3개',inStock:true},{label:'100 SOLD OUT',stockText:'100 SOLD OUT',inStock:false}]},
    {store:'코오롱몰',title:'남성 트레이닝 재킷',articleNumber:'JWJJM26321DGY',price:99000,url:'https://example.test/two',inStock:false,stockText:'현재 구매할 수 없는 상품입니다.\n품절'},
    {store:'무신사',title:'재킷',articleNumber:'EXAMPLE12345',price:89000,url:'https://example.test/three',inStock:null},
    {store:'무신사',title:'슈퍼스타 II - 블랙:화이트 / JI0079',articleNumber:'JI0079',price:149000,url:'https://example.test/shoes',inStock:true,sizes:Array.from({length:19},(_,index)=>{
      const size=220+index*5, inStock=availableShoeSizes.has(size);
      return {label:String(size),stockText:inStock?'선택 가능':'선택 불가',inStock};
    })},
  ], sources:[{store:'SSG',verificationPending:true,searchUrl:'https://example.test/search'}],
};
function measure() {
  const list=document.querySelector('.domestic-inline-results');
  const errors=[];
  if(!list) return {viewport:innerWidth,errors:['production renderer did not load']};
  const headers=[...list.querySelector('.domestic-inline-head').children];
  const rows=[...list.querySelectorAll('.domestic-inline-row')];
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

  // The old harness allowed inline styles, masking the production CSS omission.
  // Require the actual application policy to reject that inline style now.
  const policy=document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '';
  if(!/style-src 'self'/.test(policy) || /unsafe-inline/.test(policy)) errors.push('production CSP not enforced');
  const cspBlockedInline=(window.__stockCspViolations || []).some(v=>v.directive.startsWith('style-src') && v.blocked==='inline');
  if(!cspBlockedInline) errors.push('inline stylesheet was not rejected by CSP');

  const shoeCell=rows.find(row=>row.querySelector('.domestic-inline-code')?.textContent==='JI0079')?.children[2];
  const badges=[...(shoeCell?.querySelectorAll('.domestic-inline-stock-option') || [])];
  const unavailable=badges.filter(b=>b.classList.contains('soldout'));
  const available=badges.filter(b=>b.tagName==='BUTTON');
  const expectedAvailable=new Set(['220','225','230','235','240','245','255','285']);
  if(badges.length!==19 || unavailable.length!==11 || available.length!==8) errors.push('size count or availability changed');
  const cellStyle=shoeCell && getComputedStyle(shoeCell);
  if(!cellStyle || cellStyle.display!=='flex' || cellStyle.flexWrap!=='wrap'
    || parseFloat(cellStyle.rowGap)<4 || parseFloat(cellStyle.columnGap)<4) errors.push('missing individual badge spacing');
  const availableHeight=available[0]?.getBoundingClientRect().height;
  const geometry=[];
  for(const [index,badge] of badges.entries()) {
    const label=String(220+index*5), usable=expectedAvailable.has(label);
    const expected=`${label} · ${usable?'선택 가능':'선택 불가'}${usable?' ↗':''}`;
    if(badge.textContent!==expected) errors.push('retailer size/status wording changed: '+label);
    const s=getComputedStyle(badge), r=badge.getBoundingClientRect(), cell=shoeCell.getBoundingClientRect();
    // An inline-flex child of a flex container is blockified: computed display
    // is flex. Check its inner flex layout, and keep all physical box checks.
    // At 125% zoom Chromium reports a one-device-pixel border as 0.8 CSS px.
    // Require a solid visible border of at least one device pixel, not 1 CSS px.
    const borderDevicePixels=parseFloat(s.borderTopWidth)*devicePixelRatio;
    const boxStyle={display:s.display,borderStyle:s.borderTopStyle,borderWidth:s.borderTopWidth,
      borderDevicePixels,paddingLeft:s.paddingLeft,radius:s.borderTopLeftRadius};
    if(!/^(?:inline-)?flex$/.test(s.display) || s.borderTopStyle!=='solid'
      || !Number.isFinite(borderDevicePixels) || borderDevicePixels<0.99
      || parseFloat(s.paddingLeft)<6 || parseFloat(s.borderTopLeftRadius)<4) errors.push('size not individually boxed: '+label+' '+JSON.stringify(boxStyle));
    if(r.height<29 || Math.abs(r.height-availableHeight)>1) errors.push('unequal available/unavailable box height: '+label);
    if(s.whiteSpace!=='nowrap' || badge.scrollWidth>badge.clientWidth+1) errors.push('size/status split or clipped: '+label);
    if(r.left<cell.left-1 || r.right>cell.right+1) errors.push('size box outside stock column: '+label);
    if(usable) {
      if(!badge.matches('button[data-url]') || badge.disabled || badge.getAttribute('aria-disabled')==='true') errors.push('available size lost its action: '+label);
    } else {
      if(badge.tagName!=='SPAN' || badge.getAttribute('aria-disabled')!=='true' || badge.tabIndex>=0
        || badge.matches('a,button,[data-url],[onclick]') || badge.querySelector('a,button,[data-url],[onclick]')) errors.push('unavailable size became interactive: '+label);
      if(s.cursor!=='not-allowed') errors.push('unavailable cursor missing: '+label);
    }
    geometry.push({label,x:r.x,y:r.y,width:r.width,height:r.height,boxStyle});
  }
  for(let i=0;i<geometry.length;i++) for(let j=i+1;j<geometry.length;j++) {
    const a=geometry[i],b=geometry[j];
    if(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>1
      && Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>1) errors.push('size boxes overlap');
  }
  // Observe the existing data-url action contract without opening any website.
  window.__stockFixtureLinks=[];
  unavailable.forEach(badge=>badge.click());
  if(window.__stockFixtureLinks.length!==0) errors.push('unavailable size exposes a link action');
  available.forEach(badge=>badge.click());
  if(window.__stockFixtureLinks.length!==8) errors.push('available size action lost');
  return {viewport:innerWidth,devicePixelRatio,columns:getComputedStyle(rows[0]).gridTemplateColumns,cspBlockedInline,
    badgeCount:badges.length,unavailableCount:unavailable.length,availableCount:available.length,geometry,errors};
}
async function cleanup(){
  clearTimeout(deadline);
  if(win&&!win.isDestroyed())win.destroy();
  await Promise.all([fixture,fixtureStyle,fixtureBootstrap,fixtureRender].map(path=>rm(path,{force:true})));
}
(async()=>{
  await app.whenReady();await mkdir(out,{recursive:true});
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  const indexHtml=await readFile(join(root,'src/index.html'),'utf8');
  const csp=indexHtml.match(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
  if(!csp)throw new Error('Production CSP meta tag missing');
  // All fixture code/styles are same-origin external files, as in the app.
  await writeFile(fixtureStyle,'body{display:block;background:white;padding:24px}#stock-fixture{margin-left:220px;min-width:940px}');
  await writeFile(fixtureBootstrap,`let renderDomestic=()=>'';
function stockWatchRegistrationButton(){return '<button type="button" class="stock-watch-register-button">재고 감시 등록</button>';}
window.__stockCspViolations=[];
window.__stockFixtureLinks=[];
document.addEventListener('securitypolicyviolation',event=>window.__stockCspViolations.push({directive:event.effectiveDirective,blocked:event.blockedURI}));
document.addEventListener('click',event=>{const action=event.target.closest('[data-url]');if(action)window.__stockFixtureLinks.push(action.dataset.url);});
`);
  await writeFile(fixtureRender,'document.getElementById("stock-fixture").innerHTML=renderDomestic('+JSON.stringify(data)+');');
  const html='<!doctype html><html lang="ko"><head><meta charset="utf-8">'+csp+'<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="domestic-inline-results.css"><link rel="stylesheet" href=".domestic-stock-layout-fixture.css"></head><body><div id="stock-fixture"></div><script src=".domestic-stock-layout-bootstrap.js"></script><script src="domestic-inline-results.js"></script><script src=".domestic-stock-layout-render.js"></script></body></html>';
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
  console.log('PASS: 8 rendered stock-column cases with production CSP; 19 separate size boxes (8 actionable, 11 unavailable), spacing, no clipping, unchanged retailer wording and non-interactive unavailable sizes.');
  await cleanup();app.exit(0);
})().catch(async e=>{console.error(e.stack||e);await cleanup();app.exit(1)});
