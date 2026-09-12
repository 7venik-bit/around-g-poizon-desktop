import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedOfficialBrand,resolveBrandOfficialSearch} from '../services/brand-official-search.mjs';
import {VERIFIED_OFFICIAL_BRANDS,verifiedOfficialBrand,officialDomainRecordForBrand,rankOfficialDomainCandidates,auditedOfficialDomainRecord} from '../services/official-domain-registry.mjs';
import {officialMallAdapter,officialMallAdapterRecord} from '../services/official-mall-adapters.mjs';
import {queryDomesticProducts} from '../relay/domestic-search.mjs';

test('each curated brand and alias keeps its own official host through search resolution',()=>{
  for(const seed of VERIFIED_OFFICIAL_BRANDS)for(const brand of seed.aliases){
    const record=requestedOfficialBrand({brand});
    assert.equal(record.domain,seed.domain,brand);
    assert.ok(record.searchTemplate||record.interactiveSearch,brand);
  }
});

test('similar names and conflicting merchant hosts never borrow another brand adapter',()=>{
  for(const name of ['adidas collaboration studio','Some New Balance Label','Niken','Onward'])assert.equal(verifiedOfficialBrand(name),null,name);
  assert.equal(officialDomainRecordForBrand([{brandName:'New Balance',domain:'nbkorea.com'}],'Some New Balance Label'),null);
  assert.equal(officialMallAdapter({brand:'Nike',domain:'another-official.example'}),null);
  assert.equal(officialMallAdapter({brand:'Nike',domain:'thenorthfacekorea.co.kr'}).id,'north-face-kr');
  assert.equal(officialMallAdapterRecord({brandName:'Nike',domain:'another-official.example',status:'verified',searchTemplate:'https://another-official.example/find?q={query}'}).adapterId,'');
});

test('an unlisted brand discovers and persists its own search route on demand',async()=>{
  const calls=[],saved=[];
  const record=await resolveBrandOfficialSearch({input:{brand:'새 브랜드',brandId:3401,verifyLinkCounts:true},settings:{brandCatalog:[{id:3401,name:'New Label',ko:'새 브랜드'}]},
    discover:async r=>{calls.push(r);return {record:{...r,status:'verified',domain:'new-label.example',homepageUrl:'https://new-label.example/',searchTemplate:'https://new-label.example/find?term={query}'}};},persist:async r=>saved.push(r)});
  assert.equal(calls[0].brandName,'New Label');assert.equal(saved[0].registryId,'id:3401');
  const data=await queryDomesticProducts({query:'새 브랜드 ABC123',brand:'새 브랜드',articleNumber:'ABC123',title:'재킷',officialBrandRecord:record,enabledSourceGroups:['official'],fetchImpl:async()=>({ok:true,text:async()=>''})});
  assert.equal(data.sources[0].homepageUrl,'https://new-label.example/');
  assert.ok(data.sources[0].searchAttempts.some(x=>x.url.includes('new-label.example/find?term=')));
});

test('an audited store without a fixed URL keeps interactive search, while a known brand skips discovery',async()=>{
  let count=0;
  const discover=async r=>{count++;return {record:{...r,status:'search_unsupported',homepageUrl:'https://new-label.example/',domain:'new-label.example'}};};
  const unknown=await resolveBrandOfficialSearch({input:{brand:'New Label',verifyLinkCounts:true},discover});
  assert.equal(unknown.interactiveSearch,true);
  const nike=await resolveBrandOfficialSearch({input:{brand:'나이키',verifyLinkCounts:true},discover});
  assert.equal(nike.domain,'nike.com');assert.equal(count,1);
});

test('disabled official search and recent network failures avoid repeated discovery; old failures resume',async()=>{
  const now=Date.parse('2026-09-12T00:00:00Z');let calls=0;
  const discover=async r=>{calls++;return {record:r};};
  await resolveBrandOfficialSearch({input:{brand:'New Label',verifyLinkCounts:true,sourceGroups:['naver']},discover});
  const saved={brandName:'New Label',brandKo:'New Label',registryId:'name:newlabel',status:'pending',lastCheckedAt:new Date(now-60000).toISOString(),lastVerificationError:'NETWORK'};
  await resolveBrandOfficialSearch({input:{brand:'New Label',verifyLinkCounts:true},settings:{officialBrandRegistry:[saved]},now,discover});
  assert.equal(calls,0);
  await resolveBrandOfficialSearch({input:{brand:'New Label',verifyLinkCounts:true},settings:{officialBrandRegistry:[saved]},now:now+16*60000,discover});
  assert.equal(calls,1);
});

test('a canceled discovery cannot persist a late brand result',async()=>{
  let canceled=false,saved=false;
  await assert.rejects(resolveBrandOfficialSearch({input:{brand:'New Label',verifyLinkCounts:true},canceled:()=>canceled,discover:async r=>{canceled=true;return {record:r};},persist:async()=>{saved=true;}}),/DOMESTIC_SEARCH_CANCELED/);
  assert.equal(saved,false);
});

test('localized brand discovery uses its English identity and rejects a reseller body mention',()=>{
  const candidates=rankOfficialDomainCandidates([{url:'https://newlabel.example/',title:'New Label Official Store'}],'새 브랜드','New Label');
  assert.equal(candidates.length,1);
  const record={brandKo:'새 브랜드',brandName:'New Label',status:'pending'};
  assert.equal(auditedOfficialDomainRecord(record,{candidateUrl:candidates[0].url,pageTitle:candidates[0].title,searchTemplate:'https://newlabel.example/search?q={query}'}).status,'verified');
  const reseller=auditedOfficialDomainRecord(record,{candidateUrl:'https://many-brands.example/',pageTitle:'Fashion outlet',pageText:'새 브랜드 New Label 제품 판매',searchTemplate:'https://many-brands.example/search?q={query}'});
  assert.equal(reseller.status,'pending');assert.equal(reseller.lastVerificationError,'OFFICIAL_IDENTITY_UNCONFIRMED');
});

test('registry save failure does not discard a newly discovered brand search route',async()=>{
  const record=await resolveBrandOfficialSearch({input:{brand:'New Label',verifyLinkCounts:true},discover:async r=>({record:{...r,status:'verified',domain:'newlabel.example',homepageUrl:'https://newlabel.example/',searchTemplate:'https://newlabel.example/search?q={query}'}}),persist:async()=>{throw new Error('disk unavailable');}});
  assert.equal(record.domain,'newlabel.example');assert.equal(record.status,'verified');
  assert.equal(record.searchPersistenceError,'disk unavailable');
});
