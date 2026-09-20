import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {captureNativeStockControls, collectNativeStockVariants, mergeRetailerStockProducts} from '../services/retailer-stock-strategies.mjs';

test('DK mirrored purchase size radios produce four sizes, not sixteen combinations', async () => {
  // DK prod-size-1 and prod-size-2 templates mirror the same size dimension.
  const html=[1,2].map(group=>`<ul id="prod-size-${group}">${[95,100,105,110].map(size=>`<li><span><input type="radio" id="s${group}-${size}" name="rdoProdSize${group}" data-color-cd="BLU0" data-prod-cd="SR323UPS74" data-size-cd="${size}" ${size===110?'disabled':''}><label for="s${group}-${size}">${size}</label></span></li>`).join('')}</ul>`).join('');
  const dom=new JSDOM(html,{url:'https://dk-on.com/DESCENTE/product/SR323UPS74/BLU0',runScripts:'outside-only'});
  try {
    dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
    const state=dom.window.eval(`(${captureNativeStockControls.toString()})()`);
    const collected=await collectNativeStockVariants({read:async()=>state,select:async()=>{},settle:async()=>{}});
    assert.equal(collected.options.length,4);
    const [product]=mergeRetailerStockProducts([{url:dom.window.location.href,sizes:collected.options}]);
    assert.deepEqual(product.sizes.map(s=>s.label),['BLU / 95','BLU / 100','BLU / 105','BLU / 110']);
    assert.deepEqual(product.sizes.map(s=>s.inStock),[true,true,true,false]);
    assert.deepEqual(mergeRetailerStockProducts([product]),[product]);
  } finally {dom.window.close();}
});

test('DK colour already present in a size path is not prefixed twice',()=>{
  const [row]=mergeRetailerStockProducts([{url:'https://dk-on.com/DESCENTE/product/SR323UPS74/BLU0',sizes:[{label:'BLU0 / 95',optionPath:['BLU0','95'],inStock:true}]}]);
  assert.equal(row.sizes[0].label,'BLU / 95');
  assert.deepEqual(row.sizes[0].optionPath,['BLU','95']);
});

test('DK falls back to the purchase panel while excluding another colour and product',()=>{
  const radio=(id,color,model,hidden='')=>`<span ${hidden}><input type="radio" id="${id}" name="rdoProdSize${id==='top'?1:2}" data-color-cd="${color}" data-prod-cd="${model}" data-size-cd="95"><label for="${id}">95</label></span>`;
  const dom=new JSDOM(radio('top','BLU0','SR323UPS74','hidden')+radio('other','WHT0','SR323UPS74')+radio('related','BLU0','OTHER')+radio('buy','BLU0','SR323UPS74'),{url:'https://dk-on.com/DESCENTE/product/SR323UPS74/BLU0',runScripts:'outside-only'});
  try {
    dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
    const {groups}=dom.window.eval(`(${captureNativeStockControls.toString()})()`);
    assert.equal(groups.length,1);
    assert.equal(groups[0].label,'rdoProdSize2');
    assert.equal(groups[0].options.length,1);
    assert.equal(dom.window.document.querySelector(groups[0].options[0].selector).id,'buy');
  } finally {dom.window.close();}
});
