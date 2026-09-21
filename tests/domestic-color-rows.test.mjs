import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const script=readFileSync(new URL('../src/domestic-inline-results.js',import.meta.url),'utf8');
function render(t,products) {
  const dom=new JSDOM('<body><main></main></body>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  dom.window.renderDomestic=()=>'';
  dom.window.eval(script);
  dom.window.document.querySelector('main').innerHTML=dom.window.renderDomestic({products,sources:[]});
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
    assert.equal(row.children.length,6);
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
  assert.match(rows[0].textContent,/재고 1개/);
  assert.match(rows[0].textContent,/115 · 재고 확인 필요/);
  assert.match(rows[1].textContent,/90 \(품절\) 재입고 알림/);
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
  assert.match(rows[2].textContent,/재고 3개/);
});

test('unclassified options survive alongside escaped colour names',t=>{
  const rows=render(t,[{...base,store:'무신사',sizes:[
    {label:'블랙 <한정> / 95',inStock:true},
    {label:'FREE',inStock:null},
  ]}]);
  assert.equal(rows.length,2);
  assert.equal(rows[0].querySelector('.domestic-inline-color').textContent,'블랙 <한정>');
  assert.equal(rows[0].querySelector('한정'),null);
  assert.match(rows[1].textContent,/FREE · 재고 확인 필요/);
});
