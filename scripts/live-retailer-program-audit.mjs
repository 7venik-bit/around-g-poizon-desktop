// Diagnostic-only: boot the real application, click its search control and
// observe actual retailer HTTPS pages. No DOM/network/collector replacements.
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { captureDomesticDetailPage } from '../services/domestic-detail-page.mjs';
import { captureRenderedStockEvidence } from '../relay/domestic-search.mjs';

const scenarios = {
  'naver-jh9976': { articleNumber: 'JH9976', brand: '아디다스', title: '(J) 아디다스 슈퍼스타 2 클라우드 화이트 코어 블랙', group: 'naver', openUrl: 'https://shopping.naver.com/window/search/fashion-group?q=JH9976' },
  'naver-crocs': { articleNumber: '207521-001黑色', brand: '크록스', title: '크록스 클래식 크러쉬 클로그 블랙', group: 'naver', openUrl: 'https://shopping.naver.com/window/search/fashion-group?q=207521-001' },
  'official-crocs': { articleNumber: '207521-001黑色', brand: '크록스', title: '크록스 클래식 크러쉬 클로그 블랙', group: 'official' },
  'lotte-crocs': { articleNumber: '207521-001黑色', brand: '크록스', title: '크록스 클래식 크러쉬 클로그 블랙', group: 'lotte' },
};
const name = process.env.AROUNDG_LIVE_CASE;
if (!scenarios[name]) throw new Error('Unknown diagnostic scenario');
const input = scenarios[name];
const out = process.env.AROUNDG_LIVE_OUTPUT || join(tmpdir(), 'aroundg-live-output', name);
const profile = join(tmpdir(), 'aroundg-live-profile-' + name + '-' + Date.now());
mkdirSync(out, {recursive:true});
for (const key of ['home','appData','userData','sessionData','desktop','documents','downloads']) {
  const path = join(profile,key); mkdirSync(path,{recursive:true}); app.setPath(key,path);
}
for (const key of ['OneDrive','OneDriveConsumer','OneDriveCommercial']) delete process.env[key];
app.commandLine.appendSwitch('disable-gpu');
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
const report = {
  scenario:name, input, startedAt:new Date().toISOString(), platform:process.platform,
  electron:process.versions.electron, baseCommit:process.env.AROUNDG_BASE_COMMIT,
  sourceSha256:createHash('sha256').update(readFileSync(new URL('../main.mjs',import.meta.url))).digest('hex'),
  environment:'fresh Windows CI desktop; no user credentials, no user cookies',
  liveNetwork:true, mockNetwork:false, mockDom:false, mockCollectors:false,
  windows:[], samples:[], errors:[], result:null, outcome:'not_started',
};
const save = () => writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));
const shortUrl = value => {
  try {
    const u = new URL(value); if(u.protocol==='file:') return 'file://APP/'+u.pathname.split('/').slice(-2).join('/');
    for(const key of [...u.searchParams.keys()]) if(!['q','query','keyword','itemId','goodsNo'].includes(key))u.searchParams.delete(key);
    return u.href;
  } catch {return '';}
};
let finishing=false, ui=null, sequence=0;
async function finish(code) {
  if(finishing)return;finishing=true;clearTimeout(watchdog);
  report.finishedAt=new Date().toISOString();save();
  console.log('LIVE_PROGRAM_REPORT '+JSON.stringify({scenario:name,outcome:report.outcome,products:report.result?.products?.length||0,elapsedMs:Date.now()-Date.parse(report.startedAt),errors:report.errors}));
  app.exit(code);
}
const watchdog=setTimeout(()=>{report.outcome='audit_wall_timeout';void finish(2);},420_000);
const knownRetailer = value => {
  try {return /(?:^|\.)(?:naver\.com|crocs\.co\.kr|lotteon\.com|musinsa\.com|ssg\.com)$/.test(new URL(value).hostname);}catch{return false;}
};
const seenFrames=new Set(), busyWindows=new Set();
async function sample(win,label,force=false) {
  if(win.isDestroyed()||busyWindows.has(win.id)||!knownRetailer(win.webContents.getURL()))return;
  busyWindows.add(win.id);
  try {
    const frames=[win.webContents.mainFrame,...win.webContents.mainFrame.framesInSubtree.filter(frame=>frame!==win.webContents.mainFrame)];
    for(const frame of frames.slice(0,12)) {
      if(!knownRetailer(frame.url))continue;
      const key=win.id+'|'+frame.routingId+'|'+shortUrl(frame.url);
      if(!force&&seenFrames.has(key))continue;
      seenFrames.add(key);
      const snapshot=await Promise.race([
        frame.executeJavaScript(`(() => {
          const s=(${captureDomesticDetailPage.toString()})(${captureRenderedStockEvidence.toString()},[]);
          const links=[...document.querySelectorAll('a[href]')];
          const relevant=links.filter(a=>/window-products|\/products\/|\/product\/|\.html|itemView/i.test(a.href));
          return {url:location.href,title:document.title,readyState:document.readyState,
            titleText:s.titleText,visibleTitleText:s.visibleTitleText,labeledText:s.labeledText,
            structuredCodes:s.structuredCodes,ready:s.ready,busy:s.busy,hasOptions:s.hasOptions,
            bodyLength:s.fullText.length,pageText:s.fullText.slice(0,5000),
            passwordForm:!!document.querySelector('input[type="password"]'),
            linkCount:links.length,productLinkCount:relevant.length,
            productLinks:relevant.slice(0,12).map(a=>({text:(a.innerText||a.textContent||'').trim().slice(0,180),url:a.href})),
            stock:s.stockEvidence};
        })()`,true), wait(5000).then(()=>null),
      ]).catch(()=>null);
      if(snapshot) {
        snapshot.url=shortUrl(snapshot.url);
        for(const link of snapshot.productLinks||[])link.url=shortUrl(link.url);
        report.samples.push({windowId:win.id,label,frameId:frame.routingId,at:new Date().toISOString(),...snapshot});
        save();
      }
    }
    if(force) {
      const image=await Promise.race([win.webContents.capturePage(),wait(5000).then(()=>null)]).catch(()=>null);
      if(image&&!image.isEmpty())writeFileSync(join(out,`retailer-${win.id}-${++sequence}.png`),image.toPNG());
    }
  } catch(error) { report.errors.push('observer: '+String(error?.message||error));save(); }
  finally {busyWindows.delete(win.id);}
}
app.on('browser-window-created',(_event,win)=>{
  const record={id:win.id,navigations:[],failures:[]};report.windows.push(record);
  const recordNav=(url)=>{record.navigations.push({at:new Date().toISOString(),url:shortUrl(url)});save();};
  win.webContents.on('did-navigate',(_event,url)=>recordNav(url));
  win.webContents.on('did-navigate-in-page',(_event,url)=>recordNav(url));
  win.webContents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{record.failures.push({code,description,url:shortUrl(url),isMainFrame});save();});
  win.webContents.on('dom-ready',()=>{
    setTimeout(()=>void sample(win,'dom-ready',true),2500);
    setTimeout(()=>void sample(win,'settled-12s',true),12000);
  });
});
await import('../bootstrap.mjs');
await app.whenReady();
try {
  report.outcome='starting_real_app';save();
  const until=Date.now()+60_000;
  while(Date.now()<until) {
    ui=BrowserWindow.getAllWindows().find(w=>/\/src\/index\.html/.test(w.webContents.getURL()));
    if(ui) {
      const ready=await ui.webContents.executeJavaScript('Boolean(window.aroundG?.searchDomestic && typeof renderExplorerResults==="function" && renderDomestic?.__aroundGInlineList)').catch(()=>false);
      if(ready)break;
    }
    await wait(500);
  }
  if(!ui)throw new Error('APP_WINDOW_NOT_READY');
  const product={articleNumber:input.articleNumber,brand:input.brand,brandName:input.brand,title:input.title};
  if(input.openUrl) {
    report.openResult=await ui.webContents.executeJavaScript(`window.aroundG.openDomesticResult(${JSON.stringify(input.openUrl)})`,true).catch(error=>({error:error.message}));
    await wait(12_000);
    for(const w of BrowserWindow.getAllWindows())await sample(w,'operator-open-before-search',true);
  }
  await ui.webContents.executeJavaScript(`(() => {
    for (const el of document.querySelectorAll('.sidebar-search-sites input[type="checkbox"]')) {
      el.checked = el.value === ${JSON.stringify(input.group)};
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }
    renderExplorerResults('실사이트 검증 — '+${JSON.stringify(input.articleNumber)},[${JSON.stringify(product)}]);
    document.querySelector('#explorer-results').scrollIntoView({block:'start'});
    const button=document.querySelector('[data-domestic][data-index="0"]');
    if(!button)throw new Error('REAL_SEARCH_BUTTON_NOT_FOUND');
    button.click();
  })()`,true);
  report.outcome='real_search_running';save();
  const deadline=Date.now()+270_000;
  while(Date.now()<deadline) {
    const observed=await ui.webContents.executeJavaScript(`(() => {
      const p=currentExplorerProducts[0];const r=p&&domesticResults.get(domesticKey(p,0));
      return r&&!r.loading?r:null;
    })()`).catch(()=>null);
    if(observed){report.result=observed;break;}
    for(const w of BrowserWindow.getAllWindows())await sample(w,'during-real-search');
    await wait(1500);
  }
  if(!report.result) {
    await ui.webContents.executeJavaScript('window.aroundG.cancelDomesticSearch()').catch(()=>{});
    report.outcome='program_search_did_not_finish';
  } else {
    const prices=(report.result.products||[]).filter(p=>Number(p.price)>0);
    const invalid=prices.filter(p=>/메인\s*콘텐츠|건너뛰기|skip\s*to/i.test(p.title||p.name||''));
    report.outcome=prices.length&&!invalid.length?'live_product_price_observed':'live_product_price_not_observed';
    report.productsWithSalePrice=prices.length;report.invalidProductTitleCount=invalid.length;
  }
  report.rendered=await ui.webContents.executeJavaScript(`(() => {
    const e=document.querySelector('#explorer-results');e?.scrollIntoView({block:'start'});
    return {text:e?.innerText||'',rows:[...document.querySelectorAll('.domestic-inline-row')].map(e=>e.innerText)};
  })()`).catch(()=>null);
  await wait(500);
  writeFileSync(join(out,'application-result.png'),(await ui.webContents.capturePage()).toPNG());
  for(const w of BrowserWindow.getAllWindows())await sample(w,'final',true);
  await finish(report.outcome==='live_product_price_observed'?0:2);
} catch(error) {
  report.errors.push(String(error?.stack||error));report.outcome='audit_execution_error';await finish(2);
}
