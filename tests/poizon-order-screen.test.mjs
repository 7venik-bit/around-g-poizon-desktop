import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {collectPoizonSuccessfulOrders} from '../services/poizon-order-screen.mjs';

function browser(html,url='https://seller.poizon.com/main/spot/orders') {
  const dom=new JSDOM(html,{url,runScripts:'outside-only'}),{window}=dom;
  Object.defineProperty(window.HTMLElement.prototype,'innerText',{get(){return this.getAttribute('data-text')??this.textContent;}});
  return {window,contents:{executeJavaScript:script=>Promise.resolve(window.eval(script)),isDestroyed:()=>false}};
}
test('seller screen collector checks the success tab and verified order detail before returning money',async()=>{
  const cells=Array.from({length:23},(_,index)=>`<td data-text="${index===10?'거래 성공':index===12?'1':''}">${index===21?'<a>주문 내역</a>':''}</td>`).join('');
  const {window,contents}=browser(`<div class="global-text-label-wrap global-text-label-wrap-selected">전체 (2)</div>
    <div id="success" class="global-text-label-wrap">거래 성공 (1)</div>
    <table><tbody><tr class="ant-table-row" data-row-key="21315202429263299">${cells}</tr></tbody></table>
    <ul class="ant-pagination"><li class="ant-pagination-item-active">1</li><li class="ant-pagination-next ant-pagination-disabled"></li></ul>`);
  window.document.getElementById('success').addEventListener('click',event=>{
    window.document.querySelector('.global-text-label-wrap-selected').classList.remove('global-text-label-wrap-selected');
    event.currentTarget.classList.add('global-text-label-wrap-selected');
  });
  window.document.querySelector('a').addEventListener('click',()=>{
    const drawer=window.document.createElement('div');drawer.className='ant-drawer-open';
    drawer.setAttribute('data-text','주문 내역\n거래 성공\n데상트 남녀공용 카라 셔츠\n일반판매\n주문 번호: 21315202429263299\n상품 번호: SR123UPS11-Server Region\n색상:블랙/BLKO\n사이즈:SIZE 95\n입찰가(세금 별도)\n₩75,000\n예상 수익:\n₩60,000\n주문 체결 시간:\n2026/09/16 18:06:50');
    drawer.innerHTML='<div class="ant-drawer-title"><span class="ant-tag">거래 성공</span></div><div class="goods-name">데상트 남녀공용 카라 셔츠</div><button class="ant-drawer-close">닫기</button>';
    window.document.body.append(drawer);drawer.querySelector('button').addEventListener('click',()=>drawer.remove());
  });
  const result=await collectPoizonSuccessfulOrders(contents);
  assert.equal(result.orders.length,1);assert.deepEqual({price:result.orders[0].salePrice,income:result.orders[0].income,date:result.orders[0].saleDate},
    {price:75000,income:60000,date:'2026-09-16'});
});

test('seller access restriction stops collection without partial results',async()=>{
  const {contents}=browser('<main>현재 서비스 접속량이 많습니다. 잠시 후 다시 시도해주세요.</main>');
  await assert.rejects(collectPoizonSuccessfulOrders(contents),/POIZON_ACCESS_LIMITED/);
});

test('an already recorded order is counted without reopening its detail',async()=>{
  const {window,contents}=browser('<div class="global-text-label-wrap global-text-label-wrap-selected">거래 성공 (1)</div><table><tr class="ant-table-row" data-row-key="21315202429263299"></tr></table><ul class="ant-pagination"><li class="ant-pagination-item-active">1</li><li class="ant-pagination-next ant-pagination-disabled"></li></ul>');
  const row=window.document.querySelector('tr');
  for(let index=0;index<23;index++){
    const cell=window.document.createElement('td');cell.textContent=index===10?'거래 성공':'';row.append(cell);
  }
  const result=await collectPoizonSuccessfulOrders(contents,{knownOrderNumbers:['21315202429263299']});
  assert.equal(result.scanned,1);assert.equal(result.orders.length,0);
});

test('pagination waits for new order rows after the selected page number changes',async()=>{
  const first='21315202429263299',second='21315202429263300';
  const savedPages=[];
  let navigatedBeforeSave=false;
  const cells=Array.from({length:23},(_,index)=>`<td>${index===10?'거래 성공':index===12?'1':index===21?'<a>주문 내역</a>':''}</td>`).join('');
  const row=id=>`<tr class="ant-table-row" data-row-key="${id}">${cells}</tr>`;
  const {window,contents}=browser(`<div class="global-text-label-wrap global-text-label-wrap-selected">전체 (2)</div>
    <div id="success" class="global-text-label-wrap">거래 성공 (2)</div>
    <table><tbody>${row(first)}</tbody></table>
    <ul class="ant-pagination"><li class="ant-pagination-item-active">1</li><li class="ant-pagination-next"></li></ul>`);
  window.document.getElementById('success').addEventListener('click',event=>{
    window.document.querySelector('.global-text-label-wrap-selected').classList.remove('global-text-label-wrap-selected');
    event.currentTarget.classList.add('global-text-label-wrap-selected');
  });
  window.document.querySelector('.ant-pagination-next').addEventListener('click',()=>{
    navigatedBeforeSave=savedPages.length===0;
    window.document.querySelector('.ant-pagination-item-active').textContent='2';
    // POIZON can change the pagination control before replacing table rows.
    window.setTimeout(()=>{
      window.document.querySelector('tbody').innerHTML=row(second);
      window.document.querySelector('.ant-pagination-next').classList.add('ant-pagination-disabled');
    },100);
  });
  window.document.querySelector('tbody').addEventListener('click',event=>{
    if(event.target.tagName!=='A')return;
    const id=event.target.closest('tr').getAttribute('data-row-key');
    const drawer=window.document.createElement('div');drawer.className='ant-drawer-open';
    drawer.setAttribute('data-text',`일반판매\n주문 번호: ${id}\n상품 번호: SR123UPS11\n사이즈: SIZE 95\n입찰가(세금 별도) ₩75,000\n예상 수익: ₩60,000\n주문 체결 시간: 2026/09/16 18:06:50`);
    drawer.innerHTML='<div class="ant-drawer-title"><span class="ant-tag">거래 성공</span></div><button class="ant-drawer-close">닫기</button>';
    window.document.body.append(drawer);drawer.querySelector('button').addEventListener('click',()=>drawer.remove());
  });
  const result=await collectPoizonSuccessfulOrders(contents,{onPage:async page=>savedPages.push(page.orders.map(order=>order.orderNumber))});
  assert.deepEqual(result.orders.map(order=>order.orderNumber),[first,second]);
  assert.equal(result.scanned,2);
  assert.deepEqual(savedPages,[[first],[second]]);
  assert.equal(navigatedBeforeSave,false);
});
