import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {captureMusinsaLedgerPage,captureMusinsaLedgerProductIdentity} from '../services/musinsa-ledger-page.mjs';
import {advanceMusinsaLedgerToOrders,MusinsaLedgerCaptures} from '../services/musinsa-ledger-flow.mjs';

const item=({id='10001',code='AB123-001',size='블랙 / 270',qty='2',price='62,330',line='line-a',extra='',hidden=''}={})=>`<article data-order-item-id="${line}" ${hidden}>
  <a href="/products/${id}"><img alt="테스트 운동화" src="https://images.example.test/shoe.png"></a>
  <a href="/products/${id}">테스트 운동화</a><a href="/brand/test">테스트</a>
  ${code?`<p>품번: ${code}</p>`:''}<p>옵션: ${size}</p>${qty?`<p>수량: ${qty}개</p>`:''}
  ${price?`<p>실결제금액: ${price}원</p>`:''}${extra}</article>`;
const detail=content=>`<h1>주문상세</h1><p>주문번호: ORDER-10001</p><p>주문일시: 2026.9.2 12:34</p><section><h2>주문 상품</h2>${content}</section>`;
function frame(t,html,url='https://www.musinsa.com/orders/detail/ORDER-10001') {
  const dom=new JSDOM(html,{url,runScripts:'outside-only'});t.after(()=>dom.window.close());
  Object.defineProperty(dom.window.HTMLElement.prototype,'innerText',{get(){
    if(this.hidden||this.getAttribute('aria-hidden')==='true'||this.style.display==='none')return '';
    return [...this.childNodes].map(child=>child.nodeType===3?child.textContent:child.innerText||'').join('\n');
  }});
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {width:200,height:40,left:10,top:20};};
  return {window:dom.window,capture:()=>dom.window.eval(`(${captureMusinsaLedgerPage.toString()})()`),
    identity:id=>dom.window.eval(`(${captureMusinsaLedgerProductIdentity.toString()})(${JSON.stringify(id)})`)};
}

test('detail evidence keeps each option, quantity and paid amount without duplicating image/title links',t=>{
  const {capture}=frame(t,detail(item()+item({size:'화이트 / 280',line:'line-b',qty:'1',price:'55,000'})));
  const page=capture();assert.equal(page.kind,'detail');assert.equal(page.purchaseDate,'2026-09-02');
  assert.equal(page.rows.length,2);assert.equal(page.rows[0].articleNumber,'AB123-001');assert.equal(page.rows[0].quantity,2);
  assert.equal(page.rows[0].purchasePrice,62330);assert.equal(page.rows[1].krSize,'화이트 / 280');assert.equal(page.rows[1].quantity,1);
  assert.equal(page.rows[0].orderLineId,'line-a');assert.equal(page.rows[1].orderLineId,'line-b');
});
test('listing, My and lookalike hosts cannot produce order captures',t=>{
  for(const [html,url,kind] of [
    [`<h1>주문 내역</h1>${item()}`,'https://www.musinsa.com/orders','orders'],
    [`<h1>마이</h1><a href="/orders">주문/배송 조회</a>`,'https://www.musinsa.com/mypage','my'],
    [detail(item()),'https://musinsa.com.evil.test/orders/detail/1','outside'],
    [detail(item()),'https://evil.test/?site=musinsa.com','outside'],
    ['<h1>로그인</h1><input type="password">','https://member.one.musinsa.com/login','login'],
  ]){const result=frame(t,html,url).capture();assert.equal(result.kind,kind);assert.equal(result.rows,undefined);}
});
test('order capture requires one order number and a labeled purchase date',t=>{
  assert.equal(frame(t,detail(item()).replace('주문일시:','배송예정:')).capture().code,'ORDER_IDENTITY_INCOMPLETE');
  assert.equal(frame(t,detail(item())+'<p>주문번호: ORDER-20002</p>').capture().code,'ORDER_IDENTITY_INCOMPLETE');
  assert.equal(frame(t,detail(item()).replace('2026.9.2','2026.2.30')).capture().code,'ORDER_IDENTITY_INCOMPLETE');
});
test('catalog IDs, old price, shipping and total-order payments never substitute purchase evidence',t=>{
  const html=detail(item({code:'',qty:'',price:'',extra:'<p>수량 확인 중</p><del>99,000원</del><p>판매가 80,000원</p><p>쿠폰 5,000원</p>'}))+'<aside>총 결제금액 83,000원 배송비 3,000원</aside>';
  const row=frame(t,html).capture().rows[0];assert.equal(row.articleNumber,'');assert.equal(row.purchasePrice,0);assert.equal(row.quantity,0);
  assert.ok(row.missing.includes('품번'));assert.ok(row.missing.includes('상품별 실결제금액'));assert.ok(row.missing.includes('수량'));
});
test('hidden, recommended and cancelled lines are excluded without reading buyer information',t=>{
  const html=detail(item()+item({line:'cancel',extra:'<p>취소 완료</p>'})+item({line:'hidden',hidden:'hidden'}))
    +`<aside class="recommend-products">${item({line:'recommended'})}</aside><p>배송지 정보 비공개 주소</p>`;
  const result=frame(t,html).capture();assert.equal(result.rows.length,1);assert.ok(!JSON.stringify(result).includes('비공개 주소'));
});
test('product page supplements only a labeled real code for the matching product',t=>{
  const page=frame(t,'<h1>다른 상품가격 1원</h1><dl><dt>품번</dt><dd>AB123-001</dd></dl>','https://www.musinsa.com/products/10001');
  assert.equal(page.identity('10001').articleNumber,'AB123-001');assert.equal(page.identity('20002'),null);
  assert.deepEqual(Object.keys(page.identity('10001')),['articleNumber']);
  assert.equal(frame(t,'<p>상품번호 10001</p>','https://www.musinsa.com/products/10001').identity('10001'),null);
});
test('My navigation clicks only the observed order-history entry, once, and stops before selecting an order',async()=>{
  const pages=[{kind:'my',href:'https://www.musinsa.com/mypage',orderAction:{x:10,y:20}},{kind:'my',orderAction:{x:10,y:20}},{kind:'orders'}];
  const actions=[];const result=await advanceMusinsaLedgerToOrders({inspect:async()=>pages.shift(),click:async page=>actions.push(page),wait:async()=>{}});
  assert.equal(result.stage,'orders');assert.equal(actions.length,1);
});
test('login/access restrictions stop navigation without repeated clicks',async()=>{
  for(const kind of ['login','blocked','outside']){
    let clicks=0;const result=await advanceMusinsaLedgerToOrders({inspect:async()=>({kind}),click:async()=>clicks++,wait:async()=>{}});
    assert.equal(result.ok,false);assert.equal(clicks,0);
  }
});
test('main-process capture proof rejects manual rows, stale tokens and switched orders',()=>{
  const captures=new MusinsaLedgerCaptures();
  const source={orderNumber:'ORDER-10001',purchaseDate:'2026-09-02',purchaseUrl:'https://www.musinsa.com/products/10001',sourceOrderUrl:'https://www.musinsa.com/orders/detail/ORDER-10001',orderLineId:'line-a',productId:'10001'};
  assert.equal(captures.resolve(source).code,'ORDER_CAPTURE_REQUIRED');
  const [row]=captures.register([source]);assert.equal(captures.resolve(row).ok,true);
  assert.equal(captures.resolve({...row,orderNumber:'ORDER-OTHER'}).code,'ORDER_CAPTURE_MISMATCH');
  assert.equal(captures.resolve({...row,purchaseUrl:'https://evil.test'}).code,'ORDER_CAPTURE_MISMATCH');
  captures.register([source]);assert.equal(captures.resolve(row).code,'ORDER_CAPTURE_REQUIRED');
  const failed={...source,id:'saved',syncStatus:'failed',orderEvidence:{version:1,...source}};
  assert.equal(captures.resolve({...source,retryId:'saved'},failed).ok,true);
  assert.equal(captures.resolve({...source,retryId:'saved'},{...failed,orderEvidence:null}).code,'ORDER_CAPTURE_REQUIRED');
});
test('renderer cannot submit before detail capture and restores controls after errors',async t=>{
  const html=readFileSync(new URL('../src/index.html',import.meta.url),'utf8');
  const script=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8').split('let capturedLedgerRows = [];')[1].split('function openEntry(collection)')[0];
  const dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,d=w.document;let writes=0,openCalls=0;
  w.$=selector=>d.querySelector(selector);w.text=value=>String(value??'').replace(/[&<>"']/g,'');w.refresh=async()=>{};
  const row={captureId:'fixture',orderNumber:'ORDER-1',purchaseDate:'2026-09-02',brand:'테스트',modelName:'테스트 상품',articleNumber:'AB123',krSize:'블랙 / 270',purchasePrice:62330,quantity:2,purchaseUrl:'https://www.musinsa.com/products/10001',missing:[]};
  w.aroundG={openMusinsaLedger:async()=>{openCalls++;throw Error('offline');},captureMusinsaLedger:async()=>({ok:true,rows:[row],orderNumber:row.orderNumber}),syncPurchaseLedger:async input=>{writes++;assert.equal(input.captureId,'fixture');return {ok:true,rowNumber:45};}};
  w.eval('let capturedLedgerRows = [];'+script);
  const flush=()=>new Promise(resolve=>setTimeout(resolve,5));
  d.querySelector('#purchase-ledger-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();assert.equal(writes,0);
  d.querySelector('#ledger-open-musinsa').click();await flush();assert.equal(openCalls,1);assert.equal(d.querySelector('#ledger-open-musinsa').disabled,false);
  d.querySelector('#ledger-capture').click();await flush();assert.equal(d.querySelector('#ledger-submit').disabled,false);
  assert.equal(d.querySelector('#ledger-quantity').value,'2');assert.equal(d.querySelector('#ledger-order').readOnly,true);
  d.querySelector('#purchase-ledger-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();assert.equal(writes,1);assert.equal(d.querySelector('#ledger-submit').disabled,true);
  w.aroundG.captureMusinsaLedger=async()=>({ok:false,code:'ORDER_DETAIL_REQUIRED',message:'주문상세 필요'});
  d.querySelector('#ledger-capture').click();await flush();assert.equal(d.querySelector('#ledger-submit').disabled,true);assert.equal(d.querySelector('#ledger-order').value,'');
});
