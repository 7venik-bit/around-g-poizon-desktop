const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const money=text=>Number(String(text||'').replace(/[^0-9]/g,''));
const pageState=()=>({url:location.href,text:document.body?.innerText||'',passwordInput:Boolean(document.querySelector('input[type="password"],input[autocomplete="current-password"]')),
  tabs:[...document.querySelectorAll('[class*="global-text-label-wrap"]')].map(node=>node.innerText.trim()),
  selectedTab:[...document.querySelectorAll('[class*="global-text-label-wrap-selected"]')].map(node=>node.innerText.trim()).find(Boolean)||'',
  rows:[...document.querySelectorAll('tr.ant-table-row[data-row-key]')].map(node=>{
    const cells=[...node.querySelectorAll(':scope > td')].map(cell=>cell.innerText.trim());
    return {orderNumber:node.getAttribute('data-row-key'),cells};
  }),
  nextDisabled:document.querySelector('.ant-pagination-next')?.classList.contains('ant-pagination-disabled')??true,
  currentPage:document.querySelector('.ant-pagination-item-active')?.innerText.trim()||''});
async function evaluate(contents,fn,arg) {
  return contents.executeJavaScript(`(${fn.toString()})(${arg===undefined?'':JSON.stringify(arg)})`,true);
}
async function until(contents,fn,{timeout=15000,interval=400}={}) {
  const stop=Date.now()+timeout;
  do {const result=await fn();if(result)return result;await pause(interval);}while(Date.now()<stop&&!contents.isDestroyed());
  throw Error('POIZON_ORDER_PAGE_NOT_READY');
}
function pageProblem(state) {
  if(/서비스 접속량이 많습니다|일시적인 트래픽 증가|访问频繁|access denied|too many requests/i.test(state.text))return 'POIZON_ACCESS_LIMITED';
  if(/login|signin|passport|auth/i.test(state.url)||state.passwordInput&&!state.tabs.some(tab=>/^거래 성공/.test(tab)))return 'POIZON_LOGIN_REQUIRED';
  if(!state.url.startsWith('https://seller.poizon.com/'))return 'POIZON_SELLER_PAGE_UNEXPECTED';
  return '';
}
function rowDetail(node) {
  const drawer=document.querySelector('.ant-drawer-open');
  if(!drawer)return null;
  const text=drawer.innerText||'',id=String(node);
  if(!text.includes(`주문 번호: ${id}`)||!text.includes('예상 수익:'))return null;
  return {text,status:drawer.querySelector('.ant-drawer-title .ant-tag')?.innerText.trim()||'',
    productName:drawer.querySelector('[class*="goods-name"]')?.innerText.split('\n')[0]?.trim()||'',
    imageUrl:drawer.querySelector('[class*="goods-info"] img')?.getAttribute('src')||''};
}
function parseDetail(row,detail) {
  const text=detail.text,price=text.match(/입찰가\(세금 별도\)\s*₩\s*([\d,]+)/)?.[1],income=text.match(/예상 수익:\s*₩\s*([\d,]+)/)?.[1];
  const saleDate=text.match(/주문 체결 시간:\s*(\d{4})\/(\d\d)\/(\d\d)\s+\d\d:\d\d:\d\d/);
  const articleNumber=text.match(/상품 번호:\s*([^\n]+)/)?.[1]?.replace(/-Server Region$/i,'').trim();
  const size=text.match(/사이즈:\s*([^\n]+)/)?.[1]?.trim()||'';
  const route=/\n일반판매\n/.test(text)?'일반판매':'';
  const quantity=Number(row.cells[12]);
  if(!price||!income||!saleDate||!articleNumber||detail.status!=='거래 성공'||route!=='일반판매'||quantity!==1)
    throw Error(`POIZON_ORDER_DETAIL_INCOMPLETE:${row.orderNumber}`);
  const result={orderNumber:row.orderNumber,status:detail.status,route,quantity,
    articleNumber,size,color:text.match(/색상:\s*([^\n]+)/)?.[1]?.trim()||'',productName:detail.productName,imageUrl:detail.imageUrl,
    saleDate:`${saleDate[1]}-${saleDate[2]}-${saleDate[3]}`,salePrice:money(price),income:money(income)};
  if(!Number.isSafeInteger(result.salePrice)||result.salePrice<=0||result.income>result.salePrice)throw Error(`POIZON_ORDER_PRICE_INVALID:${row.orderNumber}`);
  return result;
}

// Read the rendered seller order pages. No private API, export endpoint,
// request interception, login retry, or access-limit bypass is used.
export async function collectPoizonSuccessfulOrders(contents,{onProgress=()=>{},onPage=async()=>{},knownOrderNumbers=[]}={}) {
  const initial=await until(contents,async()=>{
    const state=await evaluate(contents,pageState),problem=pageProblem(state);
    if(problem)throw Error(problem);
    return state.tabs.some(tab=>/^거래 성공\s*\(\d+\)/.test(tab))?state:null;
  });
  const counts=Object.fromEntries(initial.tabs.map(tab=>{
    const match=tab.match(/^(.+?)\s*\((\d+)\)$/);return match?[match[1],Number(match[2])]:null;
  }).filter(Boolean));
  await evaluate(contents,()=>{const node=[...document.querySelectorAll('[class*="global-text-label-wrap"]')].find(el=>/^거래 성공\s*\(\d+\)/.test(el.innerText.trim()));node?.click();});
  const expected=counts['거래 성공']||0,orders=[],seen=new Set(),known=new Set(knownOrderNumbers);
  if(!expected)return {orders,counts,scanned:0};
  let page=0;
  while(true) {
    const state=await until(contents,async()=>{
      const current=await evaluate(contents,pageState),problem=pageProblem(current);
      if(problem)throw Error(problem);
      return /^거래 성공/.test(current.selectedTab)&&current.rows.length&&current.currentPage===String(page+1)
        &&current.rows.every(row=>row.cells[10]==='거래 성공'&&!seen.has(row.orderNumber))?current:null;
    });
    const rows=state.rows;
    const pageOrders=[];
    for(const row of rows) {
      if(!/^\d{10,25}$/.test(row.orderNumber)||seen.has(row.orderNumber))throw Error('POIZON_ORDER_LIST_INCOMPLETE');
      seen.add(row.orderNumber);
      if(known.has(row.orderNumber)) {onProgress({checked:seen.size,total:expected});continue;}
      const opened=await evaluate(contents,id=>{
        const tr=[...document.querySelectorAll('tr.ant-table-row[data-row-key]')].find(n=>n.getAttribute('data-row-key')===id);
        const link=[...tr?.querySelectorAll('a')||[]].find(n=>n.innerText.trim()==='주문 내역');
        if(!link)return false;link.click();return true;
      },row.orderNumber);
      if(!opened)throw Error(`POIZON_ORDER_DETAIL_LINK_MISSING:${row.orderNumber}`);
      const detail=await until(contents,async()=>{
        const problem=pageProblem(await evaluate(contents,pageState));if(problem)throw Error(problem);
        return evaluate(contents,rowDetail,row.orderNumber);
      },{timeout:12000});
      try {pageOrders.push(parseDetail(row,detail));}
      catch(error) {
        if(!/^POIZON_ORDER_(?:DETAIL_INCOMPLETE|PRICE_INVALID):/.test(String(error?.message||error)))throw error;
        pageOrders.push({orderNumber:row.orderNumber,status:'확인 필요',failure:String(error.message)});
      }
      await evaluate(contents,()=>document.querySelector('.ant-drawer-open .ant-drawer-close')?.click());
      await until(contents,async()=>!(await evaluate(contents,()=>Boolean(document.querySelector('.ant-drawer-open')))));
      onProgress({checked:seen.size,total:expected});
      await pause(750);
    }
    orders.push(...pageOrders);
    await onPage({orders:pageOrders,checked:seen.size,total:expected,counts});
    if(state.nextDisabled)break;
    page++;
    await evaluate(contents,()=>document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled)')?.click());
  }
  if(seen.size!==expected)throw Error(`POIZON_ORDER_COUNT_MISMATCH:${seen.size}:${expected}`);
  return {orders,counts,scanned:seen.size};
}
