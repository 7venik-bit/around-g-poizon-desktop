import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { domesticProductUrlIdentity } from '../services/domestic-detail-page.mjs';
import { fitNaverFashionTownSearchQuery } from '../relay/domestic-search.mjs';
const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));
const resultUrl = 'https://shopping.naver.com/window/search/fashion-group?q=JH9977';
const productUrl = 'https://shopping.naver.com/window-products/department/123';

test('a submitted query with only external official cards reaches the bounded result collector',async()=>{
  let clicks=0;
  const win={isDestroyed:()=>false,webContents:{focus(){},getURL:()=> 'https://shopping.naver.com/window/main/fashion',
    sendInputEvent:e=>{if(e.type==='mouseUp')clicks++;},
    mainFrame:{executeJavaScript:async script=>script.startsWith('JSON.stringify')
      ? JSON.stringify({url:resultUrl,text:'아디다스 슈퍼스타',resultMatched:false,noResult:false}) : {x:100,y:40}}}};
  const context=createContext({URL,wait:async()=>{},openNaverFashionTownSearchInput:async()=>({x:10,y:10}),
    typeNaverQueryLikeUser:async()=>true,isNaverRenderedResultReady:()=>false,
    waitForNaverSearchResultsStable:async()=>false});
  runInContext(section('async function submitNaverShoppingSearch(', '\nasync function openRenderedSizeOptions('),context);
  assert.equal(await context.submitNaverShoppingSearch(win,'JH9977'),true);
  assert.equal(clicks,1);
});

test('Naver reports the field limit before trying to type an overlong query',async()=>{
  const query='코오롱스포츠 남녀공용 소로나 그래픽 라운드넥 반팔 티셔츠 TLTCM26603WHX TLTCM26603';
  let typed=false;
  const win={isDestroyed:()=>false,domesticDiagnostics:{},webContents:{focus(){},getURL:()=> 'https://shopping.naver.com/window/main/fashion-group'}};
  const context=createContext({URL,
    openNaverFashionTownSearchInput:async()=>({x:10,y:10,maxLength:50}),
    typeNaverQueryLikeUser:async()=>{typed=true;return true;}});
  runInContext(section('async function submitNaverShoppingSearch(', '\nasync function openRenderedSizeOptions('),context);
  assert.equal(await context.submitNaverShoppingSearch(win,query),false);
  assert.equal(typed,false);
  assert.equal(win.domesticDiagnostics.inputMaxLength,50);
  assert.equal(win.domesticDiagnostics.submittedQueryLength,56);
  assert.equal(win.domesticDiagnostics.submissionFailure,'query_exceeds_input_limit');
});

test('an older overlong Naver attempt submits the fitted query and records its real target URL',async()=>{
  const original='코오롱스포츠 남녀공용 소로나 그래픽 라운드넥 반팔 티셔츠 TLTCM26603WHX TLTCM26603';
  const target=`https://shopping.naver.com/window/search/fashion-group?q=${encodeURIComponent(original)}`;
  let url='',submitted='';
  const win={isDestroyed:()=>false,loadURL:async value=>{url=value;},webContents:{getURL:()=>url,
    mainFrame:{executeJavaScript:async script=>script.includes('const href = String(location.href')
      ? {href:url,text:'검색 결과',cards:1,explicitEmpty:false,positiveCount:true,documentReadyState:'complete'}
      : {href:url,text:'패션타운',ready:true}}}};
  const context=createContext({URL,fitNaverFashionTownSearchQuery,wait:async()=>{},
    domesticPageAccessState:()=>({}),isNaverRenderedResultReady:()=>true,
    clickNaverFashionTownMenu:async()=>true,
    submitNaverShoppingSearch:async(_window,query)=>{submitted=query;url=`https://shopping.naver.com/window/search/fashion-group?q=${encodeURIComponent(query)}`;return true;}});
  runInContext(section('async function loadNaverFashionTownResultPage(', '\nasync function loadDomesticRetailerResultPage('),context);
  const result=await context.loadNaverFashionTownResultPage(win,target,original);
  assert.equal(result.ok,true);
  assert.equal(submitted,fitNaverFashionTownSearchQuery(original));
  assert.equal(new URL(win.domesticDiagnostics.targetUrl).searchParams.get('q'),submitted);
  assert.equal(win.domesticDiagnostics.originalTargetUrl,target);
});

test('a visible Fashion Town menu clears a superseded ERR_ABORTED before reporting input failure',async()=>{
  let url='';
  const win={isDestroyed:()=>false,loadURL:async value=>{url=value;throw new Error('ERR_ABORTED (-3)');},
    webContents:{getURL:()=>url,mainFrame:{executeJavaScript:async()=>({href:url,text:'패션타운',ready:true})}}};
  const context=createContext({URL,fitNaverFashionTownSearchQuery,wait:async()=>{},
    domesticPageAccessState:()=>({}),
    clickNaverFashionTownMenu:async()=>{url='https://shopping.naver.com/window/main/fashion-group';return true;},
    submitNaverShoppingSearch:async()=>false});
  runInContext(section('async function loadNaverFashionTownResultPage(', '\nasync function loadDomesticRetailerResultPage('),context);
  const result=await context.loadNaverFashionTownResultPage(win,resultUrl,'JH9977');
  assert.equal(result.verificationReason,'search_submission_failed');
  assert.equal(result.resolvedUrl,url);
  assert.equal(win.domesticDiagnostics.inspectedFrames,0);
  assert.equal(win.domesticDiagnostics.navigationError,'');
});

for (const failure of ['', 'menu', 'submit', 'rate']) test(`search uses home/menu/input once and never loads a result URL: ${failure || 'success'}`, async () => {
  let url = '', calls = [], now = 0;
  const win = { isDestroyed:()=>false, loadURL:async value=>{calls.push(['load', value]);url=value;}, webContents:{getURL:()=>url,
    mainFrame:{executeJavaScript:async()=>({href:url,text:failure==='rate'?'현재 서비스 접속량이 많습니다.':'JH9977',ready:true,cards:1,documentReadyState:'complete'})}} };
  const context=createContext({URL, sanitizeDomesticQuery:s=>s, wait:async ms=>{now+=ms;},
    fitNaverFashionTownSearchQuery:s=>s,
    domesticPageAccessState:text=>text.includes('접속량')?{verificationReason:'rate_limited',rateLimited:true}:{},
    isNaverRenderedResultReady:()=>true,
    clickNaverFashionTownMenu:async()=>{calls.push(['menu']);return failure!=='menu';},
    submitNaverShoppingSearch:async(w,q)=>{calls.push(['submit',q]);url=resultUrl;return failure!=='submit';}});
  runInContext(section('async function loadNaverFashionTownResultPage(', '\nasync function loadDomesticRetailerResultPage('),context);
  const result=await context.loadNaverFashionTownResultPage(win,resultUrl,'JH9977');
  assert.deepEqual(calls.filter(c=>c[0]==='load'),[['load','https://shopping.naver.com/ns/home']]);
  assert.equal(calls.filter(c=>c[0]==='submit').length, failure==='menu'||failure==='rate'?0:1);
  assert.equal(result.ok,!failure);
  if(failure==='rate') assert.equal(result.rateLimited,true);
});

test('Naver waits past a transient empty frame and clears a recovered aborted navigation', async () => {
  let url='', inspections=0;
  const win={isDestroyed:()=>false,loadURL:async value=>{url=value;throw new Error('ERR_ABORTED');},
    webContents:{getURL:()=>url,mainFrame:{executeJavaScript:async script=>{
      if(script.includes('const href = String(location.href')) {
        inspections++;
        const empty=inspections<3;
        return {href:resultUrl,text:empty?"'JH9977'로 검색된 상품이 없습니다.":'JH9977 전체 1개',
          cards:empty?10:1,explicitEmpty:empty,positiveCount:!empty,documentReadyState:'complete'};
      }
      return {href:url,text:'JH9977',ready:true};
    }}}};
  const context=createContext({URL,sanitizeDomesticQuery:s=>s,wait:async()=>{},
    fitNaverFashionTownSearchQuery:s=>s,
    domesticPageAccessState:()=>({}),isNaverRenderedResultReady:()=>true,
    clickNaverFashionTownMenu:async()=>true,
    submitNaverShoppingSearch:async()=>{url=resultUrl;return true;}});
  runInContext(section('async function loadNaverFashionTownResultPage(', '\nasync function loadDomesticRetailerResultPage('),context);
  const result=await context.loadNaverFashionTownResultPage(win,resultUrl,'JH9977');
  assert.equal(result.ok,true);
  assert.equal(result.explicitEmpty,false);
  assert.equal(inspections,3);
  assert.equal(win.domesticDiagnostics.navigationError,'');
});

for(const redirect of [false,true]) test(`detail uses an observed card and browser back, not loadURL (redirect=${redirect})`,async t=>{
  const dom=new JSDOM(`<a target="_blank" href="${productUrl}">JH9977</a>`,{url:resultUrl,runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  let now=0, back=0, clicks=0;
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({left:10,top:10,width:100,height:40});
  dom.window.document.elementFromPoint=()=>dom.window.document.querySelector('a');
  const win={isDestroyed:()=>false,loadURL:()=>{throw new Error('direct navigation forbidden');},webContents:{
    getURL:()=>dom.window.location.href,
    mainFrame:{executeJavaScript:async script=>dom.window.eval(script)},
    navigationHistory:{canGoBack:()=>true,goBack:()=>{back++;dom.reconfigure({url:resultUrl});}},
    sendInputEvent:event=>{if(event.type==='mouseUp'){clicks++;dom.reconfigure({url:redirect?'https://shopv.pstatic.net/web/maintenance/rate-limit.html':productUrl});}}
  }};
  const context=createContext({domesticProductUrlIdentity,wait:async ms=>{now+=ms;},Date:class extends Date{static now(){return now;}}});
  runInContext(section('async function clickRenderedProductCard(', '\nfunction browserWindowUsable('),context);
  dom.reconfigure({url:'https://shopping.naver.com/window-products/department/previous'});
  assert.equal(await context.clickRenderedProductCard(win,productUrl,resultUrl,{historyOnly:true,sameWindow:true,acceptRedirect:true}),true);
  assert.equal(back,1);assert.equal(clicks,1);
  assert.equal(dom.window.document.querySelector('a').target,'_self');
});

test('missing browser history fails without replaying the search URL',async()=>{
  const context=createContext({domesticProductUrlIdentity});
  runInContext(section('async function clickRenderedProductCard(', '\nfunction browserWindowUsable('),context);
  const win={isDestroyed:()=>false,loadURL:()=>assert.fail('must not reload'),webContents:{getURL:()=>productUrl,navigationHistory:{canGoBack:()=>false}}};
  assert.equal(await context.clickRenderedProductCard(win,productUrl,resultUrl,{historyOnly:true}),false);
});
