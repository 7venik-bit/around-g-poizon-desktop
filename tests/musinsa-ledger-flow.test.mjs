import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
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

test('Musinsa login returns action and page failures immediately with the original diagnostic',async()=>{
  const main=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
  const code=main.slice(main.indexOf('async function waitForMusinsaAutomaticLogin('),main.indexOf('\nfunction openMusinsaLedgerWindow()'));
  for(const failure of ['LOGIN_ACTION_FAILED','LOGIN_PAGE_LOAD_FAILED']) {
    const status={code:failure,message:'비밀번호 입력 확인 단계에서 중단됐습니다.',diagnostic:{stage:'password_verify',reason:'LOGIN_INPUT_NOT_RETAINED'}};
    let waited=0;
    const context=createContext({shoppingAccountServices:()=>({connector:{open:async()=>{},status:()=>status}}),wait:async()=>{waited++;throw Error('must return before polling');}});
    const result=await runInContext(code+'\nwaitForMusinsaAutomaticLogin()',context);
    assert.equal(result.ok,false);assert.equal(result.code,failure);assert.equal(result.message,status.message);
    assert.equal(result.diagnostic,status.diagnostic);assert.equal(waited,0);
  }
});

test('ledger displays the original login failure message and keeps fallback messages',()=>{
  const renderer=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');
  const code=renderer.slice(renderer.indexOf('function ledgerFlowMessage('),renderer.indexOf('\nfunction renderCapturedLedgerRows()'));
  const message=runInContext(code+'\nledgerFlowMessage',createContext({}));
  const reason='비밀번호 입력란 선택 단계에서 중단됐습니다. 입력란의 초점을 확인하지 못했습니다.';
  assert.equal(message({automaticLogin:{code:'LOGIN_ACTION_FAILED',message:reason}}),reason);
  assert.match(message({automaticLogin:{code:'LOGIN_PAGE_LOAD_FAILED'}}),/로그인 페이지를 열지 못/);
  assert.match(message({automaticLogin:{code:'LOGIN_ACTION_FAILED'}}),/입력이 중단/);
  assert.match(message({automaticLogin:{code:'LOCAL_ACCOUNT_READ_FAILED'}}),/내부 장부/);
});

test('detail evidence keeps each option, quantity and paid amount without duplicating image/title links',t=>{
  const {capture}=frame(t,detail(item()+item({size:'화이트 / 280',line:'line-b',qty:'1',price:'55,000'})));
  const page=capture();assert.equal(page.kind,'detail');assert.equal(page.purchaseDate,'2026-09-02');
  assert.equal(page.rows.length,2);assert.equal(page.rows[0].articleNumber,'AB123-001');assert.equal(page.rows[0].quantity,2);
  assert.equal(page.rows[0].purchasePrice,62330);assert.equal(page.rows[1].krSize,'화이트 / 280');assert.equal(page.rows[1].quantity,1);
  assert.equal(page.rows[0].orderLineId,'line-a');assert.equal(page.rows[1].orderLineId,'line-b');
  assert.equal(page.rows[0].imageUrl,'https://images.example.test/shoe.png');
});
test('nested image and text envelopes yield one row per actual order line, preserving identical sibling lines',t=>{
  const nested=line=>`<article data-order-item-id="${line}"><a href="/products/10001"><img src="https://images.example.test/ordered.png"></a>
    <div><a href="/brands/test">Test brand</a><a href="/products/10001">Test vest</a><p>BLACK / 105 / 3개</p><p>163,460원</p></div></article>`;
  const single=frame(t,detail(nested('a'))).capture().rows;
  assert.equal(single.length,1);assert.equal(single[0].orderLineId,'a');assert.equal(single[0].quantity,3);
  assert.equal(single[0].purchasePrice,163460);assert.equal(single[0].imageUrl,'https://images.example.test/ordered.png');
  const sibling=frame(t,detail(nested('a')+nested('b'))).capture().rows;
  assert.equal(sibling.length,2);assert.deepEqual(Array.from(sibling,row=>row.orderLineId),['a','b']);
  assert.ok(sibling.every(row=>row.quantity===3 && row.purchasePrice===163460));
  const parent=frame(t,detail(`<section><a href="/products/10001">Combined summary</a>${nested('a')+nested('b')}</section>`)).capture().rows;
  assert.equal(parent.length,2);assert.deepEqual(Array.from(parent,row=>row.orderLineId),['a','b']);
});

test('order photos use product-linked lazy images instead of brand logos or placeholders',t=>{
  const black=item().replace('<a href="/products/10001"><img', '<a href="/brands/test"><img src="https://images.example.test/brand-logo.png"></a><a href="/products/10001"><img')
    .replace('src="https://images.example.test/shoe.png"','src="data:image/gif;base64,AAAA" data-src="//images.example.test/black.jpg"');
  const white=item({size:'화이트 / 280',line:'b'}).replace('src="https://images.example.test/shoe.png"','src="/placeholder.png" srcset="https://images.example.test/white-small.jpg 100w, https://images.example.test/white.jpg 400w"');
  const rows=frame(t,detail(black+white)).capture().rows;
  assert.deepEqual(Array.from(rows,row=>row.imageUrl),['https://images.example.test/black.jpg','https://images.example.test/white.jpg']);
  for(const src of ['data:image/png;base64,AAAA','javascript:alert(1)','https://user:password@images.example.test/x.png','/placeholder.png']) {
    const row=frame(t,detail(item().replace('https://images.example.test/shoe.png',src))).capture().rows[0];
    assert.equal(row.imageUrl,'');assert.ok(row.missing.includes('상품 사진'));
  }
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
test('current order detail reads the date above its order number and compact option/quantity/payment lines',t=>{
  const card=item({size:'BLACK · 105',qty:'3',price:'163,460'}).replace('<p>옵션: BLACK · 105</p><p>수량: 3개</p>','<p>BLACK · 105 / 3개</p>').replace('실결제금액: ','');
  const html='<h1>주문 상세</h1><p>26.09.17(목)</p><p>주문번호 2026091700000000</p>'+card+'<aside><h2>결제 정보</h2><p>상품 금액 327,000원</p><p>즉시 할인가 158,460원</p></aside>';
  const page=frame(t,html).capture();assert.equal(page.purchaseDate,'2026-09-17');assert.equal(page.rows.length,1);
  assert.equal(page.rows[0].krSize,'BLACK · 105');assert.equal(page.rows[0].quantity,3);assert.equal(page.rows[0].purchasePrice,163460);
  assert.equal(frame(t,html.replace('<p>26.09.17(목)</p>','')).capture().code,'ORDER_IDENTITY_INCOMPLETE');
  assert.equal(frame(t,html.replace('26.09.17(목)','26.02.30(월)')).capture().code,'ORDER_IDENTITY_INCOMPLETE');
  const uncertain=html.replace('<p>163,460원</p>','<del>327,000원</del><p>163,460원</p>');
  assert.equal(frame(t,uncertain).capture().rows[0].purchasePrice,0);
});
test('only the labeled payment method supplies the card issuer for every item',t=>{
  const ordered=detail(item()+item({line:'line-b',id:'10002'}));
  const payment='<aside><h2>결제 정보</h2><p>결제 수단</p><p>무신사페이 - 삼성카드(일시불)</p><p>무신사 삼성카드 혜택</p></aside>';
  const rows=frame(t,ordered+payment).capture().rows;
  assert.deepEqual(Array.from(rows,row=>row.cardIssuer),['삼성','삼성']);
  assert.equal(frame(t,ordered+'<p>무신사 삼성카드 혜택</p>').capture().rows[0].cardIssuer,'');
  assert.equal(frame(t,ordered+'<p>결제 수단: 무신사머니</p>').capture().rows[0].cardIssuer,'');
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
test('product photo fallback is bound to the matching catalog page and excludes recommendation images',t=>{
  const html='<meta property="og:image" content="https://images.example.test/product.jpg"><link rel="canonical" href="https://www.musinsa.com/products/10001"><p>품번: AB123-001</p><p>현재 판매가 1원</p><aside class="recommend"><img src="https://images.example.test/unrelated.jpg"></aside>';
  const identity=frame(t,html,'https://www.musinsa.com/products/10001').identity('10001');
  assert.equal(identity.imageUrl,'https://images.example.test/product.jpg');assert.equal(identity.purchasePrice,undefined);
  assert.equal(frame(t,'<meta property="og:image" content="https://images.example.test/product.jpg">','https://www.musinsa.com/products/10001').identity('10001').imageUrl,identity.imageUrl);
  assert.equal(frame(t,html,'https://www.musinsa.com/products/20002').identity('10001'),null);
  assert.equal(frame(t,html.replace('/products/10001','/products/20002'),'https://www.musinsa.com/products/10001').identity('10001').imageUrl,undefined);
  assert.equal(frame(t,html+'<p>접근 제한</p>','https://www.musinsa.com/products/10001').identity('10001'),null);
  assert.equal(frame(t,'<aside class="recommend"><img src="https://images.example.test/unrelated.jpg"></aside>','https://www.musinsa.com/products/10001').identity('10001'),null);
});
test('supplementation shares a catalog read but retains each ordered photo, option and paid price',async()=>{
  const source=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');let reads=0,closed=0;
  const context=createContext({captureMusinsaLedgerProductIdentity,DOMESTIC_SEARCH_PARTITION:'fixture',wait:async()=>{},inspectMusinsaLedgerWindow:async()=>({kind:'my'}),
    BrowserWindow:function(){return {isDestroyed:()=>false,destroy:()=>closed++,loadURL:async()=>{},webContents:{executeJavaScript:async()=>{reads++;return {articleNumber:'AB123-001',imageUrl:'https://images.example.test/catalog.jpg'};}}};}});
  runInContext(source.slice(source.indexOf('async function supplementMusinsaLedgerIdentity('),source.indexOf('function captureMusinsaLedgerOrder()')),context);
  const rows=[{productId:'10001',purchaseUrl:'https://www.musinsa.com/products/10001',articleNumber:'',imageUrl:'https://images.example.test/ordered-black.jpg',optionText:'블랙 / 270',purchasePrice:62330,quantity:2,missing:['품번']},
    {productId:'10001',purchaseUrl:'https://www.musinsa.com/products/10001',articleNumber:'ORDER-CODE',imageUrl:'',optionText:'화이트 / 280',purchasePrice:55000,quantity:1,missing:['상품 사진']}];
  const result=await context.supplementMusinsaLedgerIdentity(rows);
  assert.equal(reads,1);assert.equal(closed,1);assert.equal(result[0].imageUrl,'https://images.example.test/ordered-black.jpg');
  assert.equal(result[1].imageUrl,'https://images.example.test/catalog.jpg');assert.equal(result[1].articleNumber,'ORDER-CODE');
  assert.equal(result[0].purchasePrice,62330);assert.equal(result[0].quantity,2);assert.equal(result[1].optionText,'화이트 / 280');
  assert.deepEqual(Array.from(result,row=>row.missing),[[],[]]);
});
test('My navigation clicks only the observed order-history entry, once, and stops before selecting an order',async()=>{
  const pages=[{kind:'my',href:'https://www.musinsa.com/mypage',orderAction:{x:10,y:20}},{kind:'my',orderAction:{x:10,y:20}},{kind:'orders'}];
  const actions=[];const result=await advanceMusinsaLedgerToOrders({inspect:async()=>pages.shift(),click:async page=>actions.push(page),wait:async()=>{}});
  assert.equal(result.stage,'orders');assert.equal(actions.length,1);
});
test('current My-page history button with subtitle opens the order list once',async t=>{
  for(const label of ['주문 내역 온·오프라인, 상품권, 티켓 주문 내역 모아보기',
    '<span>주문 내역</span><span>온·오프라인, 상품권, 티켓 주문 내역 모아보기</span>']) {
    const {capture}=frame(t,`<h1>마이</h1><button>${label}</button>`,'https://www.musinsa.com/mypage');
    const observed=capture();assert.equal(observed.kind,'my');assert.ok(observed.orderAction);
    let clicks=0;
    const result=await advanceMusinsaLedgerToOrders({inspect:async()=>clicks?{kind:'orders'}:capture(),
      click:async page=>{assert.equal(page.href,observed.href);clicks++;},wait:async()=>{}});
    assert.equal(result.stage,'orders');assert.equal(clicks,1);
  }
  for(const control of ['<button>주문 내역 삭제</button>','<button><span>주문 내역</span><span>취소</span></button>',
    '<button hidden>주문 내역</button>','<a href="https://evil.test/orders">주문 내역 온·오프라인, 상품권, 티켓 주문 내역 모아보기</a>']) {
    const page=frame(t,`<h1>마이</h1>${control}`,'https://www.musinsa.com/mypage').capture();
    assert.equal(page.orderAction,null);
  }
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
  const [row]=captures.register([{...source,cardIssuer:'삼성'}]);assert.equal(captures.resolve(row).ok,true);
  assert.equal(captures.resolve({...row,cardIssuer:'다른 카드'}).cardIssuer,'삼성');
  assert.equal(captures.resolve({...row,orderNumber:'ORDER-OTHER'}).code,'ORDER_CAPTURE_MISMATCH');
  assert.equal(captures.resolve({...row,purchaseUrl:'https://evil.test'}).code,'ORDER_CAPTURE_MISMATCH');
  captures.register([source]);assert.equal(captures.resolve(row).code,'ORDER_CAPTURE_REQUIRED');
  const failed={...source,id:'saved',syncStatus:'failed',orderEvidence:{version:1,...source}};
  assert.equal(captures.resolve({...source,retryId:'saved'},failed).ok,true);
  assert.equal(captures.resolve({...source,retryId:'saved'},{...failed,orderEvidence:null}).code,'ORDER_CAPTURE_REQUIRED');
});
test('manual-login helper hands the selected detail to capture without another login or losing its window',async()=>{
  const source=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
  const makeWindow=kind=>({kind,closed:false,handlers:[],isDestroyed(){return this.closed;},
    on(event,fn){if(event==='closed')this.handlers.push(fn);},close(){this.closed=true;this.handlers.forEach(fn=>fn());}});
  const stale=makeWindow('login'),helper=makeWindow('detail');
  const context=createContext({domesticLoginWindows:new Map([['musinsa',helper]]),
    inspectMusinsaLedgerWindow:async win=>win&&!win.closed?{kind:win.kind}:null,stale});
  runInContext('let musinsaLedgerWindow=stale;stale.on("closed",()=>{if(musinsaLedgerWindow===stale)musinsaLedgerWindow=null;});\n'+
    source.slice(source.indexOf('async function resumeSelectedMusinsaLedgerWindow()'),source.indexOf('async function openMusinsaLedgerWindowAsync()')),context);
  assert.equal(await context.resumeSelectedMusinsaLedgerWindow(),helper);assert.equal(stale.closed,true);
  assert.equal(await context.resumeSelectedMusinsaLedgerWindow(),helper);assert.equal(helper.closed,false);
  helper.close();assert.equal(runInContext('musinsaLedgerWindow',context),null);
  for(const kind of ['login','blocked','orders','outside']) {
    const ignored=makeWindow(kind);context.domesticLoginWindows.set('musinsa',ignored);
    assert.equal(await context.resumeSelectedMusinsaLedgerWindow(),null);assert.equal(ignored.closed,false);
  }
});

test('renderer cannot submit before detail capture and restores controls after errors',async t=>{
  const html=readFileSync(new URL('../src/index.html',import.meta.url),'utf8');
  const script=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8').split('let capturedLedgerRows = [];')[1].split('function openEntry(collection)')[0];
  const dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,d=w.document;let writes=0,openCalls=0;
  w.$=selector=>d.querySelector(selector);w.text=value=>String(value??'').replace(/[&<>"']/g,'');w.refresh=async()=>{};
  const row={captureId:'fixture',orderNumber:'ORDER-1',purchaseDate:'2026-09-02',brand:'테스트',modelName:'테스트 상품',articleNumber:'AB123',krSize:'블랙 / 270',purchasePrice:62330,quantity:2,purchaseUrl:'https://www.musinsa.com/products/10001',imageUrl:'https://images.example.test/black.jpg',missing:[]};
  const second={...row,captureId:'second',krSize:'화이트 / 280',imageUrl:'https://images.example.test/white.jpg'};
  w.aroundGLedgerWorkbook={getPurchaseDestination:()=>({ok:true,destination:{sheetId:1,row:45,revision:'fixture'}}),beginPurchaseRecord:()=>w.aroundGLedgerWorkbook.getPurchaseDestination(),endPurchaseRecord:()=>{},showRecordedRows:async()=>({ok:true,rows:[45]})};
  w.aroundG={openMusinsaLedger:async()=>{openCalls++;throw Error('offline');},captureMusinsaLedger:async()=>({ok:true,rows:[row,second],orderNumber:row.orderNumber}),syncPurchaseLedger:async input=>{writes++;assert.equal(input.captureId,'fixture');assert.equal(input.imageUrl,row.imageUrl);return {ok:true,rowNumber:45,imageStatus:'link-only'};}};
  w.eval('let capturedLedgerRows = [];'+script);
  const flush=()=>new Promise(resolve=>setTimeout(resolve,5));
  d.querySelector('#purchase-ledger-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();assert.equal(writes,0);
  d.querySelector('#ledger-open-musinsa').click();await flush();assert.equal(openCalls,1);assert.equal(d.querySelector('#ledger-open-musinsa').disabled,false);
  d.querySelector('#ledger-capture').click();await flush();assert.equal(d.querySelector('#ledger-submit').disabled,false);
  assert.equal(d.querySelector('#ledger-quantity').value,'2');assert.equal(d.querySelector('#ledger-order').readOnly,true);
  assert.equal(d.querySelector('#ledger-image-preview').src,row.imageUrl);
  d.querySelector('[data-ledger-captured="1"]').click();assert.equal(d.querySelector('#ledger-image-preview').src,second.imageUrl);
  d.querySelector('#ledger-image-preview').dispatchEvent(new w.Event('error'));assert.equal(d.querySelector('#ledger-image-preview').hidden,true);
  d.querySelector('[data-ledger-captured="0"]').click();assert.equal(d.querySelector('#ledger-image-preview').src,row.imageUrl);assert.equal(d.querySelector('#ledger-image-preview').hidden,false);
  d.querySelector('#purchase-ledger-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();assert.equal(writes,1);assert.equal(d.querySelector('#ledger-submit').disabled,true);
  assert.match(d.querySelector('#ledger-status').textContent,/사진 주소만 저장/);
  w.aroundG.captureMusinsaLedger=async()=>({ok:false,code:'ORDER_DETAIL_REQUIRED',message:'주문상세 필요'});
  d.querySelector('#ledger-capture').click();await flush();assert.equal(d.querySelector('#ledger-submit').disabled,true);assert.equal(d.querySelector('#ledger-order').value,'');
  assert.equal(d.querySelector('#ledger-image-preview').getAttribute('src'),null);
});
