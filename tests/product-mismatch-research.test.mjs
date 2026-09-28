import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import * as matcher from '../services/matcher.mjs';
import * as relay from '../relay/domestic-search.mjs';
import {domesticProductUrlIdentity} from '../services/domestic-detail-page.mjs';

const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const production = name => {
  const start = main.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  return main.slice(start, main.indexOf('\n}\n', start) + 2);
};
const input = {articleNumber:'JWJJM26321',brand:'코오롱스포츠',title:'코오롱스포츠 남성 자켓'};
const wrongUrl = 'https://shopping.naver.com/window-products/brandfashion/13746583629?tr=swsc';
// The mismatched title/URL were observed on 2026-09-28. The matching candidate
// below is synthetic, so this test makes no claim about current availability.
const wrong = {store:'네이버 패션타운',url:wrongUrl,
  title:'[코오롱스포츠] 릿지웨이브 경량 후드 다운 자켓 JWJDW26297BLK',
  domesticSellerVerified:true,brandVerifiedFromCard:true,titleVerifiedFromDetail:true};
const exact = {...wrong,url:'https://shopping.naver.com/window-products/brandfashion/90000000001',
  title:'코오롱스포츠 남성 자켓 JWJJM26321',articleNumberVerified:true,detectedArticleNumber:'JWJJM26321'};
const attempts = [input.articleNumber,input.title,`${input.title} ${input.articleNumber}`]
  .map(query=>({query,url:`https://shopping.naver.com/window/search/fashion-group?q=${encodeURIComponent(query)}`}));
const source = {store:'네이버 패션타운',renderCount:true,linkOnly:true,searchAttempts:attempts,
  manualSearchUrl:attempts[0].url,searchQuery:attempts[0].query};

function fixture(collect) {
  const calls = [], progress = [];
  const context = createContext({...matcher,...relay,domesticProductUrlIdentity,URL,console,setTimeout,clearTimeout,
    domesticSearchGeneration:0,domesticSearchCanceled:()=>false,activeDomesticSearchWindows:new Set(),
    DOMESTIC_RETAILER_HARD_TIMEOUT_MS:90000,NAVER_COLLECTION_GRACE_MS:45000,
    OFFICIAL_DOMAIN_STATUS:{NO_OFFICIAL_STORE:'no_official_store',VERIFIED:'verified',SEARCH_UNSUPPORTED:'unsupported'},
    imageFingerprint:async()=>null,wait:async()=>{},
    recoverOfficialCollection:async options=>options.collect(options.source),
    renderedSearchSourceResult:async (s,_code,_brand,_title,_retry,attempt)=>{
      calls.push({query:attempt.query,rejected:[...s.rejectedProductUrls]});
      return collect(calls.length,attempt);
    },
  });
  for(const name of ['addMatchConfidence','addRenderedSearchCounts']) runInContext(production(name),context);
  runInContext(readFileSync(new URL('../src/domestic-result-verdict.js',import.meta.url),'utf8'),context);
  return {context,calls,progress,run:(overrides={},options=input)=>context.addRenderedSearchCounts({products:[],sources:[{...source,...overrides}]},
    options.articleNumber,options.brand,options.title,0,event=>progress.push(event),null,options)};
}
const result = products => ({products,count:products.length,presenceConfirmed:products.length>0,
  searchCompleted:true,verificationReason:'approved_domestic_seller'});

test('mismatched code then generic title proceeds to title+code and keeps only the matched shortcut',async()=>{
  const f=fixture(n=>result(n<3?[wrong]:[exact]));
  const r=await f.run();
  assert.deepEqual(f.calls.map(c=>c.query),attempts.map(a=>a.query));
  assert.equal(r.products.length,1);
  assert.equal(r.products[0].url,exact.url);
  assert.equal(r.sources[0].count,1);
  assert.equal(r.sources[0].verifiedProductUrl,exact.url);
  assert.ok(f.calls[1].rejected.some(url=>url.includes('13746583629')));
  assert.ok(f.progress.some(p=>p.source.includes('다른 상품 제외 후 다시 검색')));
});

test('all mismatches stop after distinct queries, clear the old nine-count and link, and show no match',async()=>{
  const f=fixture(()=>({...result([wrong]),count:9}));
  const r=await f.run({searchAttempts:[...attempts,attempts[1]],verifiedProductUrl:wrongUrl,count:9,presenceConfirmed:true});
  assert.equal(f.calls.length,3);
  assert.equal(r.products.length,0);
  assert.equal(r.sources[0].count,0);
  assert.equal(r.sources[0].presenceConfirmed,false);
  assert.equal(r.sources[0].verifiedProductUrl,'');
  assert.equal(r.sources[0].absenceConfirmed,true);
  assert.equal(f.context.AroundGDomesticVerdict.sourceVerdict(r.sources[0]).label,'일치 상품 없음');
});

for(const flag of ['rateLimited','securityVerificationRequired','loginRequired']) {
  test(`${flag} stops after one query and never becomes product absence`,async()=>{
    const f=fixture(()=>({...result([wrong]),[flag]:true,detailVerificationPending:true}));
    const r=await f.run();
    assert.equal(f.calls.length,1);
    assert.equal(r.sources[0].absenceConfirmed,false);
    assert.equal(r.sources[0].count,0);
    assert.equal(r.sources[0].verifiedProductUrl,'');
    assert.equal(r.sources[0][flag],true);
  });
}

test('technical failure does not trigger a new query even when captured candidates mismatch',async()=>{
  const f=fixture(()=>({...result([wrong]),verificationReason:'collection_stalled',detailVerificationPending:true}));
  const r=await f.run();
  assert.equal(f.calls.length,1);
  assert.equal(r.sources[0].absenceConfirmed,false);
});

test('an exact product with unfinished stock remains pending without needless research',async()=>{
  const f=fixture(()=>({...result([exact]),detailVerificationPending:true}));
  const r=await f.run();
  assert.equal(f.calls.length,1);
  assert.equal(r.products.length,1);
  assert.equal(r.sources[0].verificationPending,true);
});

test('image comparison reaches later candidates from the same seller',async()=>{
  const f=fixture(()=>result([])), reads=[];
  f.context.imageFingerprint=async url=>{reads.push(url);return url==='bad-image'?[false]:[true];};
  f.context.fingerprintSimilarity=(a,b)=>a[0]===b[0]?1:0;
  const products=['bad-image','good-image'].map((imageUrl,index)=>({...wrong,title:input.title,
    url:`https://shopping.naver.com/window-products/brandfashion/${index+1}`,imageUrl}));
  const r=await f.context.addMatchConfidence({products,sources:[source]},{...input,articleNumber:'',imageUrl:'source-image'});
  assert.ok(reads.includes('bad-image')&&reads.includes('good-image'));
  assert.equal(r.products.length,1);
  assert.equal(r.products[0].imageUrl,'good-image');
  assert.equal(r.sources[0].count,1);
  assert.equal(r.sources[0].verifiedProductUrl,products[1].url);
});

test('post-filter reconciliation cannot retain a conflicting source shortcut or positive flags',async()=>{
  const f=fixture(()=>result([]));
  const r=await f.context.addMatchConfidence({products:[wrong],sources:[{...source,count:9,countVerified:true,
    presenceConfirmed:true,exactProductPresenceConfirmed:true,naverTrustedChannelEvidence:true,
    naverAllSearchVerdict:'confirmed',verifiedProductUrl:wrongUrl}]},input);
  assert.equal(r.products.length,0);
  assert.equal(r.sources[0].count,0);
  assert.equal(r.sources[0].verifiedProductUrl,'');
  assert.equal(f.context.AroundGDomesticVerdict.sourceVerdict(r.sources[0]).state,'pending');
});
