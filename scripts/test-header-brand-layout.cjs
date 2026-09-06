// Render installed HTML/CSS with fixture data only; no application scripts or workbook I/O.
const { app, BrowserWindow, session } = require('electron');
const { readFile, writeFile, mkdir, rm, mkdtemp } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const root = resolve(__dirname, '..');
const out = join(root, 'layout-artifacts');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const deadline = setTimeout(() => { console.error('Layout test timed out'); app.exit(1); }, 180000);
let fixture, baselineFixture, win;
function prepare() {
  const q = (s) => document.querySelector(s);
  const brand = q('#explorer-brand'), group = q('#frequent-brand-group');
  brand.hidden = false; brand.classList.add('active'); group.hidden = false;
  [...brand.children].forEach((e) => { if (e !== group) e.hidden = true; });
  brand.prepend(group);
  q('#frequent-brand-count').textContent = '36개';
  q('#completed-brand-toggle').hidden = false;
  q('#completed-brand-toggle').textContent = '전체보기 (36개)';
  document.querySelectorAll('.frequent-brand-heading-actions > button').forEach((b) => b.disabled = false);
  if (!q('#poizon-review-brand-start')) {
    const b = document.createElement('button'); b.id = 'poizon-review-brand-start';
    b.textContent = 'POIZON 대조'; q('.frequent-brand-heading-actions').append(b);
  }
  q('#notification-count').hidden = false; q('#notification-count').textContent = '61';
  q('#update-panel').hidden = true;
  q('#onedrive-lamps').className = 'window-dots sourcing';
  const names = ['KOLON SPORT', 'Discovery Expedition', 'DIESEL', 'Dickies', 'BE@RBRICK', 'BALMAIN', 'Keen', 'DESCENTE', '아모레퍼시픽', 'PUMA'];
  q('#frequent-brand-cards').innerHTML = names.map((name) => '<button class="brand-card brand-pinned download-complete"><i>G</i><span><strong>' + name + '</strong><em class="brand-download-complete">다운완료</em></span></button>').join('');
  return { scripts: document.scripts.length, styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((e) => e.getAttribute('href')) };
}
function measure() {
  const q = (s) => document.querySelector(s);
  const box = (e) => { const r = e.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
  const lines = (e) => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size; };
  const buttons = ['notification-open','update-check','export-button'].map((id) => ({ id, ...box(q('#'+id)) }));
  const anchor = box(q('.header-actions > .update-anchor'));
  const title = q('#frequent-brand-title'), count = q('#frequent-brand-count');
  const heading = box(q('#frequent-brand-group > .brand-list-group-heading'));
  const titleGroup = box(title.parentElement);
  const actions = [...document.querySelectorAll('.frequent-brand-heading-actions > button')].filter((e) => e.getClientRects().length).map(box);
  const errors = [];
  for (let i=1;i<buttons.length;i++) {
    const sameRow = Math.abs(buttons[i].y-buttons[i-1].y) <= 1;
    if (sameRow) {
      const gap = buttons[i].x - buttons[i-1].right;
      if (Math.abs(gap-8)>1) errors.push('header gap: '+gap);
    }
  }
  if (Math.abs(anchor.width-buttons[1].width)>1) errors.push('update anchor has blank width');
  for (const b of buttons) if (Math.abs(b.height-32)>1) errors.push('button height: '+b.id);
  if (lines(title)!==1 || lines(count)!==1) errors.push('title or count wrapped');
  if (count.scrollWidth > count.clientWidth+1) errors.push('count clipped');
  const a=box(title), b=box(count);
  if (b.x<a.right || Math.abs((a.y+a.height/2)-(b.y+b.height/2))>2) errors.push('title/count alignment');
  if (getComputedStyle(q('.frequent-brand-heading-actions > small')).display!=='none') errors.push('description still visible');
  for (const r of actions) {
    if (r.x<heading.x-1 || r.right>heading.right+1) errors.push('brand action outside heading');
    if (r.x<titleGroup.right-1 && r.right>titleGroup.x+1 && r.y<titleGroup.bottom-1 && r.bottom>titleGroup.y+1) errors.push('action overlaps title');
  }
  if (getComputedStyle(q('.download-sync-anchor')).display!=='none') errors.push('retired sync is visible');
  const lamps = [...document.querySelectorAll('#onedrive-lamps i')].map((e) => { const s=getComputedStyle(e);return [s.animationName,s.animationDuration,s.animationDelay,s.backgroundColor]; });
  return { viewport:innerWidth, buttons, anchor, title:box(title), count:box(count), countText:count.textContent, heading, lamps, errors };
}
async function evaluate(fn) { return win.webContents.executeJavaScript('('+fn.toString()+')()'); }
async function screenshot(name) {
  const image = await win.webContents.capturePage();
  await writeFile(join(out, name+'.png'), image.toPNG());
}
async function cleanup() {
  if (win && !win.isDestroyed()) win.destroy();
  for (const p of [fixture,baselineFixture]) if(p) await rm(p,{force:true}).catch(()=>{});
  clearTimeout(deadline);
}
(async () => {
  app.setPath('userData', await mkdtemp(join(tmpdir(), 'poizon-layout-')));
  await app.whenReady(); await mkdir(out, { recursive:true });
  session.defaultSession.webRequest.onBeforeRequest({ urls:['http://*/*','https://*/*'] }, (_details, cb) => cb({ cancel:true }));
  const source = (await readFile(join(root,'src/index.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  fixture = join(root,'src','.header-brand-layout-fixture.html');
  baselineFixture = join(root,'src','.header-brand-layout-baseline.html');
  await writeFile(fixture, source, 'utf8');
  await writeFile(baselineFixture, source.replace(/\s*<link\b[^>]*id="header-brand-layout-styles"[^>]*>/g,''), 'utf8');
  win = new BrowserWindow({ show:false,width:1426,height:900,useContentSize:true,webPreferences:{ nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true } });
  await win.loadFile(baselineFixture); await evaluate(prepare);
  await win.webContents.executeJavaScript('document.fonts.ready');
  const baseline=await evaluate(measure); await screenshot('before-1426');
  await win.loadFile(fixture);
  const setup=await evaluate(prepare);
  await win.webContents.executeJavaScript('document.fonts.ready');
  if (setup.scripts!==0) throw new Error('Fixture must not execute application scripts');
  if (!setup.styles.includes('./header-brand-layout.css')) throw new Error('Installed stylesheet is missing');
  const results=[];
  for (const width of [980,1040,1220,1426,1666,1920,2560]) for (const scale of [1,1.25,1.5]) {
    win.setContentSize(width,900);
    win.webContents.setZoomFactor(scale);
    await new Promise((resolve) => setTimeout(resolve, 35));
    for (const state of ['normal','updating']) {
      const count=state==='normal'?'36개':'9,999개', text=state==='normal'?'자동 업데이트':'업데이트 다운로드 중…';
      await win.webContents.executeJavaScript('document.getElementById("frequent-brand-count").textContent='+JSON.stringify(count)+';document.getElementById("update-check").textContent='+JSON.stringify(text));
      const result=await evaluate(measure);
      if (!Number.isFinite(result.viewport) || result.viewport < 300) result.errors.push('invalid viewport');
      if(JSON.stringify(result.lamps)!==JSON.stringify(baseline.lamps)) result.errors.push('traffic light animation changed');
      results.push({width,scale,state,...result});
      if(state==='normal'&&scale===1&&[1040,1426,1920].includes(width)) await screenshot('after-'+width);
    }
  }
  const failed=results.filter((r)=>r.errors.length);
  await writeFile(join(out,'results.json'),JSON.stringify({setup,baseline,total:results.length,failed:failed.length,results},null,2));
  console.log(JSON.stringify({total:results.length,failed:failed.length,baselineErrors:baseline.errors,failures:failed},null,2));
  if(failed.length) throw new Error(failed.length+' rendered layout cases failed');
  if(!baseline.errors.length) throw new Error('Original screenshot defect was not reproduced');
  console.log('PASS: actual installed HTML/CSS, 42 window/zoom/state cases, original defect reproduced.');
  await cleanup(); app.exit(0);
})().catch(async(error)=>{
  console.error(error.stack||error);
  try{if(win&&!win.isDestroyed())await screenshot('failure');}catch{}
  await cleanup(); app.exit(1);
});
