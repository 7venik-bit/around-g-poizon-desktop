const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const money=text=>Number(String(text||'').replace(/[^0-9]/g,''));
const articleKey=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const saleInProgress=status=>/^(?:거래 성공|발송 대기|발송 완료|판매자 발송 완료)$/.test(String(status||'').trim());
const listArticle=row=>row.productInfo.match(/상품 번호\s*[:：]\s*([^\n]+)/)?.[1]?.replace(/-Server Region$/i,'').trim()||'';
const purchaseArticleMatch=(row,articles)=>{
  if(!articles?.length)return true;
  const key=articleKey(listArticle(row));
  return key.length>=5&&articles.some(article=>article===key||article.startsWith(key)||key.startsWith(article));
};
const amount=(text,label)=>{
  const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const found=String(text||'').match(new RegExp(`${escaped}\\s*[:：]?\\s*(?:\\(\\d+(?:\\.\\d+)?%\\)\\s*)?(?:-\\s*)?(?:₩\\s*)?([\\d,]+)\\s*(?:원)?`));
  return found?money(found[1]):null;
};
const pageState=()=>({url:location.href,text:document.body?.innerText||'',passwordInput:Boolean(document.querySelector('input[type="password"],input[autocomplete="current-password"]')),
  tabs:[...document.querySelectorAll('[class*="global-text-label-wrap"]')].map(node=>node.innerText.trim()),
  selectedTab:[...document.querySelectorAll('[class*="global-text-label-wrap-selected"]')].map(node=>node.innerText.trim()).find(Boolean)||'',
  rows:[...document.querySelectorAll('tr.ant-table-row[data-row-key]')].map(node=>{
    const cells=[...node.querySelectorAll(':scope > td')].map(cell=>cell.innerText.trim());
    const headers=[...node.closest('table')?.querySelectorAll('thead th')||[]].map(cell=>cell.innerText.trim().replace(/\s+/g,' '));
    const column=(label,fallback)=>{const index=headers.findIndex(header=>header.includes(label));return index<0?fallback:index;};
    const image=node.querySelector('img');
    return {orderNumber:node.getAttribute('data-row-key'),cells,
      imageUrl:image?.getAttribute('src')||image?.getAttribute('data-src')||'',
      productInfo:cells.find(cell=>/상품 번호\s*[:：]/.test(cell))||cells[2]||'',
      optionInfo:cells.find(cell=>/색상\s*[:：]|사이즈\s*[:：]|포장\s*[:：]/.test(cell))||cells[3]||'',
      status:cells[column('주문 상태',10)]||'',quantity:cells[column('수량',12)]||'',
      incomeText:cells[column('예상 총 수익',14)]||'',priceText:cells[column('구매자 결제 금액',15)]||'',
      timeline:cells[column('거래 타임라인',18)]||''};
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
  if(!text.includes(`주문 번호: ${id}`)||!text.includes('예상 수익:')
    ||!/입찰가\(세금 별도\)\s*₩\s*[\d,]+/.test(text)
    ||!/예상 수익:\s*₩\s*[\d,]+/.test(text))return null;
  return {text,status:drawer.querySelector('.ant-drawer-title .ant-tag')?.innerText.trim()||'',
    productName:drawer.querySelector('[class*="goods-name"]')?.innerText.split('\n')[0]?.trim()||'',
    imageUrl:drawer.querySelector('[class*="goods-info"] img')?.getAttribute('src')||drawer.querySelector('[class*="goods-info"] img')?.getAttribute('data-src')||''};
}
function parseDetail(row,detail) {
  const text=detail.text,price=amount(text,'입찰가(세금 별도)'),income=amount(text,'예상 수익'),basicFee=amount(text,'기본 수수료');
  const timestamp=(source,label)=>source.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d{4})[./-](\\d{1,2})[./-](\\d{1,2})\\s+(\\d{1,2}:\\d{2}:\\d{2})`));
  const closed=timestamp(text,'주문 체결 시간')||timestamp(row.timeline,'주문 체결 시간');
  const paid=timestamp(text,'구매자 결제(?: 시간)?')||timestamp(row.timeline,'구매자 결제(?: 시간)?');
  const stamp=match=>match?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')} ${match[4]}`:'';
  const articleNumber=text.match(/상품 번호\s*[:：]\s*([^\n]+)/)?.[1]?.replace(/-Server Region$/i,'').trim();
  const listedArticle=listArticle(row);
  const size=text.match(/사이즈\s*[:：]\s*([^\n]+)/)?.[1]?.trim()||row.optionInfo.match(/사이즈\s*[:：]\s*([^\n]+)/)?.[1]?.trim()||'';
  const packaging=text.match(/포장\s*[:：]\s*([^\n]+)/)?.[1]?.trim()||row.optionInfo.match(/포장\s*[:：]\s*([^\n]+)/)?.[1]?.trim()||'';
  const color=text.match(/색상\s*[:：]\s*([^\n]+)/)?.[1]?.trim()||row.optionInfo.match(/색상\s*[:：]\s*([^\n]+)/)?.[1]?.trim()||'';
  const imageUrl=detail.imageUrl||row.imageUrl;
  const route=/\n일반판매\n/.test(text)?'일반판매':'';
  const quantity=Number(row.quantity);
  if(price==null||income==null||basicFee==null||!closed||!paid||!articleNumber||(!size&&!packaging)||!imageUrl||!saleInProgress(detail.status)||route!=='일반판매'||quantity!==1)
    throw Error(`POIZON_ORDER_DETAIL_INCOMPLETE:${row.orderNumber}`);
  const result={orderNumber:row.orderNumber,status:detail.status,route,quantity,
    articleNumber,size,packaging,color,productName:detail.productName||row.productInfo,imageUrl,
    buyerPaidAt:stamp(paid),orderClosedAt:stamp(closed),saleDate:stamp(closed).slice(0,10),
    salePrice:price,basicFee,income};
  if(listedArticle&&articleKey(listedArticle)!==articleKey(articleNumber)
    ||row.priceText&&money(row.priceText)!==price
    ||row.incomeText&&money(row.incomeText)!==income)
    throw Error(`POIZON_ORDER_LIST_DETAIL_MISMATCH:${row.orderNumber}`);
  if(!Number.isSafeInteger(price)||price<=0||!Number.isSafeInteger(basicFee)||basicFee<0||basicFee>price
    ||!Number.isSafeInteger(income)||income<0||income>price-basicFee)
    throw Error(`POIZON_ORDER_PRICE_INVALID:${row.orderNumber}`);
  return result;
}
function expandProfitDetails() {
  const drawer=document.querySelector('.ant-drawer-open');
  if(!drawer||/기본 수수료/.test(drawer.innerText||''))return false;
  const item=[...drawer.querySelectorAll('button,[role="button"],a,[class*="collapse-header"]')]
    .find(node=>/예상 수익(?:내역)?|수익 내역|수수료 상세/.test(node.innerText||''));
  if(!item)return false;
  item.click();return true;
}

// Read the rendered seller order pages. No private API, export endpoint,
// request interception, login retry, or access-limit bypass is used.
export async function collectPoizonSuccessfulOrders(contents,{onProgress=()=>{},onPage=async()=>{},knownOrderNumbers=[],includeInProgress=false,candidateArticleNumbers=[]}={}) {
  const tabName=includeInProgress?'전체':'거래 성공';
  const articles=[...new Set(candidateArticleNumbers.map(articleKey).filter(key=>key.length>=5))];
  const initial=await until(contents,async()=>{
    const state=await evaluate(contents,pageState),problem=pageProblem(state);
    if(problem)throw Error(problem);
    return state.tabs.some(tab=>new RegExp(`^${tabName}\\s*\\(\\d+\\)`).test(tab))?state:null;
  });
  const counts=Object.fromEntries(initial.tabs.map(tab=>{
    const match=tab.match(/^(.+?)\s*\((\d+)\)$/);return match?[match[1],Number(match[2])]:null;
  }).filter(Boolean));
  await evaluate(contents,name=>{const node=[...document.querySelectorAll('[class*="global-text-label-wrap"]')].find(el=>el.innerText.trim().startsWith(`${name} (`));node?.click();},tabName);
  const expected=counts[tabName]||0,orders=[],seen=new Set(),known=new Set(knownOrderNumbers);
  if(!expected)return {orders,counts,scanned:0};
  let page=0;
  while(true) {
    const state=await until(contents,async()=>{
      const current=await evaluate(contents,pageState),problem=pageProblem(current);
      if(problem)throw Error(problem);
      return current.selectedTab.startsWith(tabName)&&current.rows.length&&current.currentPage===String(page+1)
        &&current.rows.every(row=>(includeInProgress||row.status==='거래 성공')&&!seen.has(row.orderNumber))?current:null;
    });
    const rows=state.rows;
    const pageOrders=[];
    for(const row of rows) {
      if(!/^\d{10,25}$/.test(row.orderNumber)||seen.has(row.orderNumber))throw Error('POIZON_ORDER_LIST_INCOMPLETE');
      seen.add(row.orderNumber);
      if(!saleInProgress(row.status)||!purchaseArticleMatch(row,articles)) {onProgress({checked:seen.size,total:expected});continue;}
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
      if(!/기본 수수료/.test(detail.text)) {
        const expanded=await evaluate(contents,expandProfitDetails);
        if(expanded)await until(contents,async()=>{
          const current=await evaluate(contents,rowDetail,row.orderNumber);
          return current&&/기본 수수료/.test(current.text)?current:null;
        },{timeout:4000}).then(current=>Object.assign(detail,current)).catch(()=>{});
      }
      try {pageOrders.push(parseDetail(row,detail));}
      catch(error) {
        if(!/^POIZON_ORDER_(?:DETAIL_INCOMPLETE|PRICE_INVALID|LIST_DETAIL_MISMATCH):/.test(String(error?.message||error)))throw error;
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
