import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fn = name => {
  const start = main.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0);
  return main.slice(start, main.indexOf('\n}\n', start) + 2);
};

test('blocked batch skips session checks and login opening for every remaining product', async () => {
  const context = {blockedNaverLoginScopes:new Map(), NAVER_LOGIN_SCOPE_TTL_MS:60000,
    domesticLoginSourceIdsForSearch:()=>['naver'], domesticLoginSource:()=>({id:'naver'}),
    domesticLoginFailure:(_source,code,message)=>({code,message}),
    hasUsableDomesticLoginSession:()=>assert.fail('must not reopen authentication'),
    naverLoginScopeConfirmed:()=>false,
    Date, Map,
  };
  runInNewContext(fn('naverLoginScopeRestriction') + '\n' + fn('waitForDomesticLoginsBeforeSearch'), context);
  context.naverLoginScopeRestriction('batch-1',{loginRequired:true});
  for (let product = 0; product < 5; product++) {
    const result = await context.waitForDomesticLoginsBeforeSearch(['naver'],()=>{},'batch-1');
    assert.equal(result.ok, false);
    assert.equal(result.failures[0].code, 'DOMESTIC_LOGIN_REQUIRED');
  }
  assert.equal(context.naverLoginScopeRestriction('user-started-new-batch'), null);
});

test('security restriction remains distinct and stores no product or authentication data', () => {
  const context = {blockedNaverLoginScopes:new Map(), NAVER_LOGIN_SCOPE_TTL_MS:100, Date, Map};
  runInNewContext(fn('naverLoginScopeRestriction'), context);
  const value = context.naverLoginScopeRestriction('batch',{securityVerificationRequired:true,url:'private',products:[{price:123}]},1000);
  assert.equal(value.code, 'NAVER_VERIFICATION_REQUIRED');
  assert.doesNotMatch(JSON.stringify([...context.blockedNaverLoginScopes]), /private|123/);
  assert.equal(context.naverLoginScopeRestriction('batch',null,1101), null);
});

test('a rate-limited batch never opens login and stays distinct from expired authentication', async () => {
  const context = {blockedNaverLoginScopes:new Map(),NAVER_LOGIN_SCOPE_TTL_MS:60000,Date,Map,
    domesticLoginSourceIdsForSearch:()=>['naver'],domesticLoginSource:()=>({id:'naver'}),
    hasUsableDomesticLoginSession:()=>assert.fail('rate limiting must not initiate login'),
    domesticLoginSourceGroup:id=>id,naverLoginScopeConfirmed:()=>false};
  runInNewContext(['naverLoginScopeRestriction','domesticLoginFailure','waitForDomesticLoginsBeforeSearch'].map(fn).join('\n'),context);
  context.naverLoginScopeRestriction('batch',{rateLimited:true});
  for(let i=0;i<5;i++) {
    const result=await context.waitForDomesticLoginsBeforeSearch(['naver'],()=>{},'batch');
    assert.equal(result.failures[0].rateLimited,true);
    assert.equal(result.failures[0].loginRequired,false);
    assert.equal(result.failures[0].securityVerificationRequired,false);
    assert.equal(result.failures[0].errorCode,'NAVER_RATE_LIMITED');
  }
});
