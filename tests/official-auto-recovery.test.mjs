import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {diagnoseOfficialCollection, recoverOfficialCollection} from '../services/official-auto-recovery.mjs';

const code = 'AB1234';
const url = 'https://new-brand.example/products/AB1234';
const source = {store:'브랜드 공식몰', homepageUrl:'https://new-brand.example/', verifiedProductUrl:url};
const product = {store:source.store, url, articleNumber:code, price:49000, stockVerified:true,
  stockCoverage:'observed', sizes:[{label:'BLU / 95', inStock:true}]};
const good = {products:[product], count:1};
const failed = {products:[], detailVerificationPending:true, verificationReason:'result_capture_failed'};
const run = options => recoverOfficialCollection({source, code, ...options});

test('diagnosis remains visible after a successful recovery', () => {
  const script=readFileSync(new URL('../src/domestic-inline-results.js',import.meta.url),'utf8');
  const start=script.indexOf('  function renderSearchDiagnostics(');
  const fn=runInNewContext('('+script.slice(start,script.indexOf('  function renderStockCell(',start)).trim()+')',{URL,URLSearchParams,safeText:String});
  const html=fn([{...source,autoRecovery:{status:'recovered',issues:['price_missing'],attempts:[{url,issues:[]}]}}]);
  assert.match(html,/복구 완료/);assert.match(html,/가격 누락/);assert.match(html,/성공/);
});

test('invalid option observations are withheld and a direct detail is never retried twice', async () => {
  let calls=0;
  const result=await run({source:{...source,directProductUrls:[url]},collect:async()=>{calls++;return {
    products:[{...product,sizes:[{label:'공유하기',inStock:true}]}]};}});
  assert.equal(calls,1);assert.equal(result.products[0].stockVerified,false);
  assert.deepEqual(result.products[0].sizes,[]);assert.equal(result.detailVerificationPending,true);
});

test('unknown merchant automatically changes from search to known detail without brand rules', async () => {
  const calls=[];
  const result=await run({collect:async candidate=>{calls.push(candidate);return calls.length===1?failed:good;}});
  assert.equal(calls.length,2);
  assert.deepEqual(calls[1].directProductUrls,[url]);
  assert.equal(result.products[0].price,49000);
  assert.equal(result.autoRecovery.status,'recovered');
  assert.equal(result.detailVerificationPending,false);
});

test('healthy and authoritative absent collections make no additional requests', async () => {
  for(const initial of [good,{products:[],absenceConfirmed:true}]) {
    let calls=0;
    assert.deepEqual(await run({collect:async()=>{calls++;return initial;}}),initial);
    assert.equal(calls,1);
  }
});

test('login, traffic limits, captcha and nested detail login stop without retry', async () => {
  for(const failure of [{loginRequired:true},{rateLimited:true},{securityVerificationRequired:true},
    {verificationReason:'captcha'}, {verificationDiagnostics:{lastDetailState:{loginFormVisible:true}}}]) {
    let calls=0;
    const result=await run({collect:async()=>{calls++;return {...failed,...failure};}});
    assert.equal(calls,1);assert.equal(result.autoRecovery.status,'blocked');
  }
});

test('recovery is bounded and never fabricates absence on unresolved detail', async () => {
  let calls=0;
  const result=await run({collect:async()=>{calls++;return failed;}});
  assert.equal(calls,2);assert.equal(result.autoRecovery.status,'partial');
  assert.equal(result.absenceConfirmed,false);assert.equal(result.detailVerificationPending,true);
});

test('search URLs, unrelated domains and other model codes are not recovery targets', async () => {
  for(const target of ['https://evil.example/products/AB1234','https://new-brand.example/search?query=AB1234',
    'https://new-brand.example/products/OTHER','https://new-brand.example/']) {
    let calls=0;
    const result=await run({source:{...source,verifiedProductUrl:target},collect:async()=>{calls++;return failed;}});
    assert.equal(calls,1);assert.equal(result.autoRecovery.status,'manual');
  }
});

test('bad prices, utility options, duplicate options and wrong identities cannot pass diagnosis', () => {
  assert.ok(diagnoseOfficialCollection({products:[{...product,price:0}]},code).includes('price_missing'));
  assert.ok(diagnoseOfficialCollection({products:[{...product,sizes:[{label:'공유하기',inStock:true}]}]},code).includes('non_product_option'));
  assert.ok(diagnoseOfficialCollection({products:[{...product,sizes:[...product.sizes,...product.sizes]}]},code).includes('duplicate_options'));
  assert.ok(diagnoseOfficialCollection({products:[{...product,articleNumber:'OTHER'}]},code).includes('identity_mismatch'));
});

test('another colour remains intact and incomplete recovery cannot overwrite a verified product', async () => {
  const other={...product,url:url+'/WHITE',colorName:'화이트'};
  let calls=0;
  const result=await run({collect:async()=>++calls===1
    ?{...failed,products:[other,{...product,price:0,stockVerified:false}]}
    :{products:[{...product,articleNumber:'OTHER'}]}});
  assert.ok(result.products.some(p=>p.url===other.url&&p.price===49000));
  assert.equal(result.autoRecovery.status,'partial');
});

test('restriction during recovery prevents remaining details and cancellation prevents new requests', async () => {
  let calls=0;
  const initial={...failed,products:[{...product,url:url+'/BLACK',price:0},{...product,url:url+'/WHITE',price:0}]};
  const result=await run({collect:async()=>++calls===1?initial:{rateLimited:true}});
  assert.equal(calls,2);assert.equal(result.autoRecovery.status,'blocked');
  calls=0;
  await assert.rejects(run({canceled:()=>true,collect:async()=>{calls++;return failed;}}),/CANCELED/);
  assert.equal(calls,1);
});
