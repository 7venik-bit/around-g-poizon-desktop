import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeRetailerStockProducts} from '../services/retailer-stock-strategies.mjs';

test('Descente BLACK and WHITE keep independent rows and same-size inventory', () => {
  const row = {store:'브랜드 공식몰',articleNumber:'SR123UTL11',title:'터프 긴팔 티셔츠',price:62100};
  const input = [
    {...row,url:'https://dk-on.com/DESCENTE/product/SR123UTL11/BLK0',sizes:[{label:'85',inStock:false}],inStock:false},
    {...row,url:'https://dk-on.com/DESCENTE/product/SR123UTL11/WHT0',sizes:[{label:'85',inStock:true}],inStock:true},
  ];
  const result = mergeRetailerStockProducts(input);
  assert.equal(result.length,2);
  assert.deepEqual(result.map(p=>[p.colorName,p.sizes[0].label,p.sizes[0].inStock]),[['블랙','블랙 / 85',false],['화이트','화이트 / 85',true]]);
  assert.deepEqual(result.map(p=>p.title),['터프 긴팔 티셔츠 [블랙]','터프 긴팔 티셔츠 [화이트]']);
  assert.deepEqual(mergeRetailerStockProducts(result),result);
  assert.equal(input[0].title,'터프 긴팔 티셔츠');
  const duplicate={...input[0],url:input[0].url+'?utm_source=repeat'};
  assert.equal(mergeRetailerStockProducts([...input,duplicate]).length,2);
});
