import test from 'node:test';
import assert from 'node:assert/strict';
import { retailerStockStrategy, normalizeStockQuantity, normalizeStockOptions, collectNativeStockVariants, mergeRetailerStockProducts } from '../services/retailer-stock-strategies.mjs';
import { normalizeRenderedStockEvidence } from '../services/domestic-stock.mjs';

test('stock strategy follows the actual merchant host even when discovered through Naver', () => {
  for (const [host,id] of [['nike.com','nike'],['www.ssg.com','ssg'],['department.ssg.com','ssg'],['www.lotteon.com','lotteon'],['brand.naver.com','naver'],['www.kolonmall.com','kolon'],['www.musinsa.com','musinsa'],['dk-on.com','descente'],['www.adidas.co.kr','adidas'],['www.nbkorea.com','newbalance'],['www.mlb-korea.com','fnf'],['www.discovery-expedition.com','fnf'],['kr.puma.com','salesforce'],['www.underarmour.co.kr','salesforce'],['www.asics.com','salesforce'],['www.vans.co.kr','salesforce'],['www.crocs.co.kr','salesforce'],['keenfootwear.kr','godo'],['neweracapkorea.com','makeshop']]) {
    assert.equal(retailerStockStrategy({url:`https://${host}/product/1`,store:'네이버 패션타운'}).id,id,host);
  }
  for (const host of ['on.com','salomon.co.kr','dickieskr.com','new-brand.example']) {
    assert.ok(retailerStockStrategy({url:`https://${host}/product/1`}).optionSelectors.includes('select option'));
  }
  assert.equal(retailerStockStrategy({url:'https://nike.com.example/product/1'}).id,'semantic');
});

test('inventory quantities remain numeric; absent quantity is not zero', () => {
  for(const value of [null,undefined,'',true,'-',-1,'1.5','구매 제한 3개']) assert.equal(normalizeStockQuantity(value),null);
  assert.equal(normalizeStockQuantity('1,200'),1200);
  assert.equal(normalizeStockQuantity(0),0);
  const sizes=normalizeStockOptions([{name:'블랙',goodsOptions:[{name:'95',stockQuantity:3},{name:'100',stockQuantity:0},{name:'105'}]},{name:'화이트',goodsOptions:[{name:'95',outOfStock:false},{name:'100',stockText:'SOLD OUT'}]}]);
  assert.deepEqual(sizes.map(s=>[s.label,s.inStock,s.quantity]),[['블랙 / 95',true,3],['블랙 / 100',false,0],['블랙 / 105',null,undefined],['화이트 / 95',true,undefined],['화이트 / 100',false,undefined]]);
  const result=normalizeRenderedStockEvidence({options:sizes});
  assert.equal(result.sizes[0].quantity,3);
  assert.equal(result.sizes[1].quantity,0);
  assert.equal(normalizeRenderedStockEvidence({options:[{label:'95'}]}).inStock,null);
  assert.equal(normalizeRenderedStockEvidence({options:[{label:'95',inStock:false},{label:'100',inStock:null}]}).inStock,null);
});

test('dependent options are reread for every colour, retaining same-sized distinct variants', async () => {
  let color='';const selected=[],progress=[];
  const result=await collectNativeStockVariants({
    read:async()=>({groups:[{options:[{label:'선택',placeholder:true},{label:'블랙',value:'black',inStock:true},{label:'화이트',value:'white',inStock:true}]},{options:color==='black'?[{label:'95',inStock:true},{label:'100 품절',inStock:false}]:color==='white'?[{label:'95',inStock:false}]:[]}]}),
    select:async(_group,option)=>{color=option.value;selected.push(color);},settle:async()=>{},onProgress:u=>progress.push(u),
  });
  assert.deepEqual(selected,['black','white']);
  assert.deepEqual(result.options.map(o=>[o.label,o.inStock]),[['블랙 / 95',true],['블랙 / 100 품절',false],['화이트 / 95',false]]);
  assert.equal(result.complete,true);assert.equal(progress.length,3);
});

test('option failures preserve already collected branches and never claim complete coverage', async () => {
  let color='';
  const result=await collectNativeStockVariants({read:async()=>({groups:[{options:[{label:'블랙',value:'black'},{label:'화이트',value:'white'}]},{options:color==='black'?[{label:'95',inStock:true}]:[]}]}),select:async(_g,o)=>{color=o.value;},settle:async()=>{if(color==='white')throw new Error('network');}});
  assert.deepEqual(result.options.map(o=>o.label),['블랙 / 95']);assert.equal(result.complete,false);
});

test('cancellation stops dependent option traversal without visiting the next branch', async () => {
  let canceled=false,selected=0;
  await assert.rejects(collectNativeStockVariants({read:async()=>({groups:[{options:[{label:'블랙'},{label:'화이트'}]},{options:[{label:'95'}]}]}),select:async()=>{selected++;canceled=true;},settle:async()=>{},canceled:()=>canceled}),/DOMESTIC_SEARCH_CANCELED/);
  assert.equal(selected,1);
});

test('fresh detail stock replaces the search API result, while unknown detail preserves API sizes', () => {
  const api={store:'무신사',id:'1',inStock:true,sizes:[{label:'95',quantity:3,inStock:true}]};
  assert.equal(mergeRetailerStockProducts([api,{...api,inStock:false,stockText:'품절',sizes:[]}])[0].inStock,false);
  const preserved=mergeRetailerStockProducts([api,{store:'무신사',id:'1',inStock:null,sizes:[],stockText:''}])[0];
  assert.equal(preserved.sizes[0].quantity,3);
});
