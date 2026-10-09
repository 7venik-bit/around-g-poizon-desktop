import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const script=readFileSync(new URL('../src/domestic-inline-results.js',import.meta.url),'utf8');
function render(t,products,sources=[]) {
  const dom=new JSDOM('<body><main></main></body>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  dom.window.renderDomestic=()=>'';
  dom.window.eval(script);
  dom.window.document.querySelector('main').innerHTML=dom.window.renderDomestic({products,sources});
  return [...dom.window.document.querySelectorAll('.domestic-inline-row')];
}
const base={title:'데상트 카라 셔츠',articleNumber:'SR123UPS11',price:84550,inStock:true,stockVerified:true};

test('Naver renders six separate colour rows without dropping any of the 54 options',t=>{
  const colors=['BEG0_BEIGE','BLK0_BLACK','CORL_CORAL','WHT0_WHITE','DNVY_DARK-NAVY','LGRN_LIGHT-GREEN'];
  const sizes=colors.flatMap(color=>[85,90,92,95,100,105,110,115,120].map(size=>({label:`${color} / ${size}`,inStock:color==='WHT0_WHITE'&&size>=110})));
  const product={...base,store:'네이버 패션타운',url:'https://shopping.naver.com/window-products/brandfashion/12842936435',sizes};
  const before=structuredClone(product),rows=render(t,[product]);
  assert.equal(rows.length,6);
  assert.deepEqual(rows.map(row=>row.dataset.stockColor),colors);
  for(const [index,row] of rows.entries()) {
    assert.equal(row.children.length,5);
    assert.equal(row.querySelector('.domestic-inline-color').textContent,colors[index]);
    const options=[...row.querySelectorAll('.domestic-inline-stock-option')];
    assert.equal(options.length,9);
    assert.ok(options.every(option=>option.textContent.startsWith(colors[index]+' / ')));
    assert.equal(row.querySelector('.domestic-inline-price').textContent,'84,550원');
    assert.equal(decodeURIComponent(row.querySelector('.domestic-inline-actions [data-url]').dataset.url),product.url);
  }
  assert.equal(rows.flatMap(row=>[...row.querySelectorAll('button.domestic-inline-stock-option')]).length,3);
  assert.deepEqual(product,before,'presentation must not change saved stock evidence');
});

test('stock chips share one calm palette across every style source',()=>{
  const css=readFileSync(new URL('../src/domestic-inline-results.css',import.meta.url),'utf8');
  const inline=readFileSync(new URL('../src/domestic-inline-results.js',import.meta.url),'utf8');
  const appCss=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
  assert.match(css, /\.domestic-inline-stock-cell>\.domestic-inline-stock-option\{[^}]*border:1px solid #b9c9dc/);
  assert.match(css, /\.domestic-inline-stock-cell>\.domestic-inline-stock-option\{[^}]*background:#e7eef6/);
  assert.match(css, /\.domestic-inline-stock-cell>\.domestic-inline-stock-option\{[^}]*color:#33587e/);
  assert.match(css, /\.domestic-inline-stock-cell>\.domestic-inline-stock-option\.soldout\{[^}]*background:#f0f1f3/);
  assert.match(css, /\.domestic-inline-stock-cell>\.domestic-inline-stock-option\.soldout\{[^}]*color:#6d747d/);
  assert.match(inline, /\.domestic-inline-stock-option\{[^}]*border:1px solid #b9c9dc/);
  assert.match(inline, /\.domestic-inline-stock-option\{[^}]*background:#e7eef6/);
  assert.match(inline, /\.domestic-inline-stock-option\{[^}]*color:#33587e/);
  assert.match(inline, /\.domestic-inline-stock-option\.soldout\{[^}]*background:#f0f1f3/);
  assert.match(inline, /\.domestic-inline-stock-option\.soldout\{[^}]*color:#6d747d/);
  assert.match(appCss, /\.size-chip\.available\{background:#e7eef6;color:#33587e/);
  assert.match(appCss, /\.size-chip\.soldout\{background:#f0f1f3;color:#6d747d/);
  assert.match(appCss, /\.size-chip\.unknown\{background:#f3f0e8;color:#77694f/);
  assert.match(appCss, /\.stock-state\.soldout\{background:#f0f1f3;color:#6d747d/);
  assert.doesNotMatch(appCss, /\.size-chip\.soldout\{background:#ffe5e1/);
  assert.doesNotMatch(appCss, /\.stock-state\.soldout\{background:#fff0d8/);
});

test('restock notices collapse to the bare size',t=>{
  const rows=render(t,[{...base,store:'무신사',url:'https://www.musinsa.com/products/1',sizes:[
    {label:'245 (품절) 재입고 알림',stockText:'245 (품절) 재입고 알림',inStock:false},
    {label:'255',stockText:'255',inStock:true,url:'https://www.musinsa.com/products/1?size=255'},
    {label:'260 내일(토) 도착보장',stockText:'260 내일(토) 도착보장',inStock:true,url:'https://www.musinsa.com/products/1?size=260'},
    {label:'265 SOLD OUT',stockText:'265 SOLD OUT',inStock:false},
  ]}]);
  assert.deepEqual([...rows[0].querySelectorAll('.domestic-inline-stock-option')].map(o=>o.textContent),['245','255','260','265']);
  assert.equal(rows[0].querySelector('.soldout').tagName,'SPAN');
  assert.doesNotMatch(rows[0].textContent,/재입고 알림|품절|SOLD OUT|도착보장/);
});

test('Musinsa groups interleaved colour paths while retaining quantities, notices and option links',t=>{
  const url='https://www.musinsa.com/products/4693116';
  const product={...base,store:'데상트',sourceStore:'무신사',url,stockText:'회원 전용',stockCoverage:'partial',purchaseLimitText:'1인당 최대 1개 구매 가능',sizes:[
    {label:'화이트 / 110',optionPath:['화이트','110'],quantity:1,inStock:true,url:url+'?size=110'},
    {label:'블랙 / 85',optionPath:['블랙','85'],inStock:true},
    {label:'화이트 / 115',optionPath:['화이트','115'],inStock:null},
    {label:'블랙 / 90 (품절)',optionPath:['블랙','90 (품절)'],stockText:'90 (품절) 재입고 알림',inStock:false},
  ]};
  const rows=render(t,[product]);
  assert.deepEqual(rows.map(row=>row.dataset.stockColor),['화이트','블랙']);
  assert.equal(rows[0].querySelector('button.domestic-inline-stock-option').textContent,'화이트 / 110');
  assert.equal(rows[0].querySelector('span.domestic-inline-stock-option').textContent,'화이트 / 115');
  assert.equal(rows[1].querySelector('span.domestic-inline-stock-option.soldout').textContent,'블랙 / 90');
  assert.doesNotMatch(rows[1].textContent,/재입고 알림/);
  assert.equal(decodeURIComponent(rows[0].querySelector('button.domestic-inline-stock-option').dataset.url),url+'?size=110');
  for(const row of rows) {
    assert.match(row.textContent,/회원 전용/);
    assert.match(row.textContent,/일부 옵션 재고 확인 필요/);
    assert.match(row.textContent,/구매 제한: 1인당 최대 1개 구매 가능/);
  }
  assert.equal(rows[1].querySelector('.soldout').tagName,'SPAN');
});

test('size-only, unknown and official rows are preserved without inventing colours',t=>{
  const products=[
    {...base,store:'무신사',sizes:[{label:'S / M',inStock:true},{label:'270 / 275',inStock:false}]},
    {...base,store:'네이버 패션타운',sizes:[],inStock:null,stockVerified:false},
    {...base,store:'브랜드 공식몰',title:'셔츠 [화이트]',sizes:[{label:'화이트 / 110',quantity:3,inStock:true}]},
  ];
  const rows=render(t,products);
  assert.equal(rows.length,3);
  assert.ok(rows.every(row=>!row.hasAttribute('data-stock-color')));
  assert.match(rows[1].textContent,/재고 확인 필요/);
  assert.match(rows[2].textContent,/화이트 \/ 110/);
  assert.doesNotMatch(rows[2].querySelector('.domestic-inline-stock-cell').textContent,/재고/);
});

test('unclassified options survive alongside escaped colour names',t=>{
  const rows=render(t,[{...base,store:'무신사',sizes:[
    {label:'블랙 <한정> / 95',inStock:true},
    {label:'FREE',inStock:null},
  ]}]);
  assert.equal(rows.length,2);
  assert.equal(rows[0].querySelector('.domestic-inline-color').textContent,'블랙 <한정>');
  assert.equal(rows[0].querySelector('한정'),null);
  assert.equal(rows[1].querySelector('.domestic-inline-stock-option').textContent,'FREE');
});

test('one seller cell spans official products and Naver/Musinsa colour rows without changing their actions',t=>{
  const official=color=>({...base,store:'브랜드 공식몰',title:`셔츠 [${color}]`,url:`https://example.test/${encodeURIComponent(color)}`,sizes:[{label:`${color} / 95`,quantity:3,inStock:true}]});
  const colors=store=>({...base,store,url:`https://example.test/${encodeURIComponent(store)}`,sizes:[{label:'블랙 / 95',inStock:true},{label:'화이트 / 95',inStock:false}]});
  // Interleaved products from the same seller still share a single cell.
  const products=[official('화이트'),colors('네이버 패션타운'),official('블랙'),colors('무신사')];
  const sources=[{store:'브랜드 공식몰',officialStatus:'verified'},{store:'네이버 패션타운'},{store:'무신사'},
    {store:'SSG',verificationPending:true,searchUrl:'https://example.test/search'}];
  const before=structuredClone({products,sources}),rows=render(t,products,sources);
  const list=rows[0].closest('.domestic-inline-results');
  const groups=[...list.querySelectorAll('.domestic-inline-retailer-group')];
  assert.deepEqual(groups.map(group=>group.getAttribute('aria-label')),['브랜드 공식몰','네이버 패션타운','무신사']);
  for(const group of groups) {
    assert.equal(group.querySelectorAll('.domestic-inline-store').length,1);
    assert.equal(group.querySelectorAll('.domestic-inline-row').length,2);
    assert.equal(group.querySelectorAll('.domestic-inline-row .domestic-inline-store').length,0);
    assert.equal(group.querySelectorAll('.domestic-inline-price').length,2);
  }
  assert.equal(groups[0].querySelectorAll('.domestic-inline-official').length,1);
  assert.equal(groups[1].querySelectorAll('.domestic-inline-official').length,0);
  const titles=[...groups[0].querySelectorAll('.domestic-inline-title')].map(title=>title.textContent);
  assert.deepEqual(titles,['셔츠 [화이트]','셔츠 [블랙]']);
  assert.deepEqual([...groups[0].querySelectorAll('.domestic-inline-actions [data-url]')].map(button=>decodeURIComponent(button.dataset.url)),[products[0].url,products[2].url]);
  assert.equal(list.querySelectorAll('.domestic-inline-stock-option').length,6);
  assert.equal(list.querySelector('.domestic-inline-fallback .domestic-inline-store').textContent,'SSG');
  assert.deepEqual({products,sources},before);
});

test('seller groups do not transfer official status or merge different sources with the same display name',t=>{
  const products=[
    {...base,store:'무신사',retailerName:'데상트',officialStoreVerified:true},
    {...base,store:'무신사',retailerName:'데상트'},
    {...base,store:'네이버 패션타운',retailerName:'데상트'},
  ];
  const rows=render(t,products);
  const groups=[...rows[0].closest('.domestic-inline-results').querySelectorAll('.domestic-inline-retailer-group')];
  assert.equal(groups.length,3);
  assert.deepEqual(groups.map(group=>group.querySelectorAll('.domestic-inline-official').length),[1,0,0]);
});

test('seller badges drop the operation-type suffix without merging groups',t=>{
  const rows=render(t,[
    {...base,store:'SSG 브랜드 공식관',retailerName:'브랜드 공식관 · 본사직영',url:'https://example.test/a',sizes:[{label:'230',inStock:true}]},
    {...base,store:'SSG 브랜드 공식관',retailerName:'브랜드 공식관 · 공식수입',url:'https://example.test/b',sizes:[{label:'240',inStock:true}]},
  ]);
  const groups=[...rows[0].closest('.domestic-inline-results').querySelectorAll('.domestic-inline-retailer-group')];
  assert.equal(groups.length,2);
  for (const group of groups) {
    assert.equal(group.querySelector('.domestic-inline-retailer-label span').textContent,'SSG닷컴 브랜드 공식관');
    assert.equal(group.getAttribute('aria-label'),'SSG닷컴 브랜드 공식관');
  }
});

test('a generic official-mall badge without a market store falls back to the short name',t=>{
  const rows=render(t,[{...base,store:'SSG',retailerName:'브랜드 공식관 · 본사직영',url:'https://example.test/a',sizes:[{label:'230',inStock:true}]}]);
  const label=rows[0].closest('.domestic-inline-retailer-group').querySelector('.domestic-inline-retailer-label span');
  assert.equal(label.textContent,'브랜드 공식관');
});

test('domestic rows center-align text and actions',t=>{
  const product={...base,store:'브랜드 공식몰',retailerName:'브랜드 공식몰',url:'https://example.test/one',sizes:[{label:'230',inStock:true}]};
  const sources=[{store:'브랜드 공식몰',officialStatus:'verified',count:1,countVerified:true}];
  const rows=render(t,[product],sources);
  const row=rows[0],view=row.ownerDocument.defaultView;
  const cs=sel=>view.getComputedStyle(row.querySelector(sel));
  assert.equal(cs('.domestic-inline-title').textAlign,'center');
  assert.equal(cs('.domestic-inline-code').textAlign,'center');
  assert.equal(cs('.domestic-inline-price').textAlign,'center');
  assert.equal(cs('.domestic-inline-stock-cell').justifyContent,'center');
  assert.equal(cs('.domestic-inline-actions').justifyContent,'center');
  const group=row.closest('.domestic-inline-retailer-group');
  assert.equal(view.getComputedStyle(group.querySelector('.domestic-inline-retailer-label')).justifyContent,'center');
  const head=row.closest('.domestic-inline-results').querySelector('.domestic-inline-head');
  assert.equal(view.getComputedStyle(head).textAlign,'center');
});

test('fallback rows right-align their action links like product rows',t=>{
  const product={...base,store:'브랜드 공식몰',url:'https://example.test/one',sizes:[{label:'230',inStock:true}]};
  const sources=[{store:'브랜드 공식몰',officialStatus:'verified',count:1,countVerified:true},
    {store:'롯데온',absenceConfirmed:true,searchCompleted:true,searchUrl:'https://www.lotteon.com/csearch/search?q=SR123UPS11',searchQuery:'SR123UPS11'}];
  const rows=render(t,[product],sources);
  assert.equal(rows.length,2);
  for(const row of rows) {
    const actions=row.querySelector(':scope > .domestic-inline-actions');
    assert.ok(actions,'every row aligns its action cell');
    assert.equal(actions.querySelector('button[data-url]')?.textContent,'열기');
  }
});

test('merged seller names are escaped and unknown inventory remains unknown',t=>{
  const rows=render(t,[{...base,store:'무신사',retailerName:'판매처 <한정>',inStock:null,stockVerified:false},
    {...base,store:'무신사',retailerName:'판매처 <한정>',inStock:false}]);
  const group=rows[0].closest('.domestic-inline-retailer-group');
  assert.equal(group.getAttribute('aria-label'),'판매처 <한정>');
  assert.equal(group.querySelector('.domestic-inline-store').textContent,'판매처 <한정>');
  assert.equal(group.querySelector('한정'),null);
  assert.equal(rows[0].querySelector('.domestic-inline-stock-cell').textContent,'재고 확인 필요');
  assert.equal(rows[1].querySelector('.domestic-inline-stock-cell').textContent,'품절');
});
