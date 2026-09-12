// A strategy follows the actual retailer host, not the POIZON brand label.
// Unlisted/new brands still receive semantic option and native-select discovery.
const PROFILES = [
  {id:'northface',hosts:['thenorthfacekorea.co.kr'],options:['.product-variations .selector-size input[type="radio"]']},
  {id:'skechers',hosts:['skecherskorea.co.kr'],options:['.product-variations .selector-size input[type="radio"]']},
  {id:'lululemon',hosts:['lululemon.co.kr'],options:['.swatches.size a','.swatches.size button','[data-attr="size"] button','[class*="size" i] input']},
  {id:'musinsa',hosts:['musinsa.com'],options:['[data-testid*="option"] [role="option"]','[class*="option" i] button','[class*="option" i] li']},
  {id:'naver',hosts:['naver.com','smartstore.naver.com','brand.naver.com'],options:['[data-shp-area-id="optsize"]','[role="listbox"] [role="option"]','[class*="option" i] li','[class*="select" i] li']},
  {id:'ssg',hosts:['ssg.com','shinsegaemall.ssg.com'],options:['.cdtl_opt_select option','.cdtl_opt_lst li','.cdtl_select_lst li','[class*="cdtl_opt"] [role="option"]']},
  {id:'lotteon',hosts:['lotteon.com'],options:['[class*="option" i] li','[class*="option" i] button','[class*="select" i] [role="option"]']},
  {id:'kolon',hosts:['kolonmall.com'],options:['[data-size]','[role="radio"]','[class*="size" i] button']},
  {id:'nike',hosts:['nike.com'],options:['[data-testid="pdp-grid-selector-grid"] input[type="radio"]','input[name="skuAndSize"]','input[name*="size" i]','[data-testid*="size"] input']},
  {id:'adidas',hosts:['adidas.co.kr'],options:['[data-auto-id="size-selector"] button','[data-auto-id*="size"] [role="radio"]']},
  {id:'newbalance',hosts:['nbkorea.com'],options:['[class*="size" i] input','[class*="size" i] button','[class*="size" i] li']},
  {id:'descente',hosts:['dk-on.com'],options:['[class*="size" i] button','[class*="option" i] button','[class*="size" i] input']},
  {id:'fnf',hosts:['mlb-korea.com','discovery-expedition.com'],options:['[class*="size" i] button','[class*="option" i] button','[data-size]']},
  {id:'salesforce',hosts:['puma.com','underarmour.co.kr','asics.com','vans.co.kr','crocs.co.kr'],options:['.select-size option','.swatches.size a','.swatches.size button','[data-attr="size"] button','[data-attr="size"] input','[class*="size" i] button']},
  {id:'godo',hosts:['keenfootwear.kr'],options:['select[name*="option"] option','.item_choice_list option','.item_choice_list input']},
  {id:'makeshop',hosts:['neweracapkorea.com'],options:['select[name*="option"] option','.MK_optAddWrap option']},
  {id:'semantic',hosts:['salomon.co.kr','dickieskr.com','on.com'],options:['[class*="size" i] button','[class*="size" i] input','[role="radio"]']},
];

export function retailerStockStrategy({url='',store=''}={}) {
  let host='';try{host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{}
  const profile=PROFILES.find(p=>p.hosts.some(h=>host===h||host.endsWith('.'+h)))
    ||(!host?PROFILES.find(p=>({musinsa:/무신사/,naver:/네이버/,ssg:/^SSG/,lotteon:/롯데온/,kolon:/코오롱몰/}[p.id])?.test(store)):null);
  return {
    id:profile?.id||'semantic',
    host,
    optionSelectors:[...new Set([...(profile?.options||[]),'select option','[role="option"]','[data-size]','[data-option]','input[type="radio"][name*="size" i]','[class*="size" i] button','[class*="option" i] li'])],
  };
}

export function normalizeStockQuantity(value) {
  if(value===null||value===undefined||value===''||typeof value==='boolean')return null;
  const text=String(value).replace(/,/g,'').trim();
  if(!/^\d+$/.test(text))return null;
  const number=Number(text);return Number.isSafeInteger(number)?number:null;
}

export function normalizeStockOptions(options=[]) {
  const rows=[];
  const walk=(items,prefix=[])=>{
    for(const option of Array.isArray(items)?items:[]){
      if(option===null||option===undefined)continue;
      const label=typeof option==='object'?option.sizeName||option.optionName||option.name||option.label||option.value||option.code:String(option);
      const path=[...prefix,...(label?[String(label)]:[])];
      const children=option.goodsOptions||option.children||option.optionList;
      if(Array.isArray(children)&&children.length){walk(children,path);continue;}
      if(!path.length)continue;
      const quantity=normalizeStockQuantity(option.stockQuantity??option.stockQty??option.stock??option.quantity);
      const raw=String(option.stockText||option.statusText||option.soldOutMessage||'').trim();
      const unavailable=option.inStock===false||option.available===false||option.isSoldOut===true||option.outOfStock===true||option.soldOutYn==='Y'||quantity===0||/품절(?!\s*임박)|매진|SOLD[\s_-]*OUT|재고\s*없/i.test(raw);
      const available=quantity>0||option.inStock===true||option.available===true||option.isSoldOut===false||option.outOfStock===false||option.soldOutYn==='N';
      rows.push({label:path.join(' / '),inStock:unavailable?false:available?true:null,...(raw?{stockText:raw}:{}),...(quantity!==null?{quantity}: {})});
    }
  };
  walk(options);return rows;
}

export function mergeRetailerStockProducts(products = []) {
  const found = new Map();
  for (const product of products) {
    const key = `${product.store}:${product.id || product.url}`;
    const previous = found.get(key);
    const merged = {...previous, ...product};
    // Fresh detail evidence wins, especially sold-out. A page with no stock
    // evidence must not erase the API options collected in the same search.
    if (previous && product.inStock == null && !product.stockText && !product.sizes?.length) {
      for (const field of ['inStock','sizes','stockText','stockStatus','stockVerified','purchaseLimitText']) {
        if (previous[field] !== undefined) merged[field] = previous[field];
      }
    }
    found.set(key, merged);
  }
  return [...found.values()];
}

// Traverse dependent native selects through their normal change events. Every
// branch is reread after selection; a colour must never be reported as a size.
export async function collectNativeStockVariants({read,select,settle,onProgress=()=>{},canceled=()=>false,maxCombinations=1000}) {
  const rows=[],seen=new Set();let complete=true,reason='';
  const visit=async(prefix,depth)=>{
    if(canceled())throw new Error('DOMESTIC_SEARCH_CANCELED');
    const state=await read(depth);
    const groups=state.groups||[];
    const group=groups[depth];
    if(!group){if(depth){complete=false;reason='options_not_loaded';}return;}
    if(depth>5){complete=false;reason='option_depth_limit';return;}
    const choices=(group.options||[]).filter(o=>!o.placeholder);
    if(!choices.length){complete=false;reason='options_not_loaded';return;}
    for(const option of choices){
      if(canceled())throw new Error('DOMESTIC_SEARCH_CANCELED');
      if(rows.length>=maxCombinations){complete=false;reason='option_count_limit';return;}
      const path=[...prefix,option.label];
      const leaf=depth===groups.length-1;
      if(leaf||option.inStock===false){
        const label=path.join(' / '),key=path.join('\u0000');
        if(!seen.has(key)){seen.add(key);rows.push({...option,label});await onProgress({completed:rows.length,label});}
      }else{
        try { if(group.kind!=='static'){await select(group,option);await settle();}await visit(path,depth+1); }
        catch(error) { if(canceled())throw error;complete=false;reason='options_not_loaded'; }
      }
    }
  };
  await visit([],0);return {options:rows,complete,reason};
}

// Serialized into the retailer document. No application globals or requests.
export function captureNativeStockControls() {
  const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.closest('[hidden],[aria-hidden="true"]')&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';};
  const excluded='header,footer,nav,[class*="recommend" i],[class*="review" i],[class*="delivery" i],[class*="shipping" i],[class*="sizeguide" i],[class*="sizetable" i],[class*="size-guide" i],[class*="size-chart" i],[class*="restock" i],[id*="restock" i],[class*="additional" i],[hidden],[aria-hidden="true"]';
  const scope=document.querySelector('.cdtl_col_rgt')||document.querySelector('.product-variations')||document.querySelector('main')||document;
  const selects=[...scope.querySelectorAll('select')].filter(el=>(visible(el)||visible(el.parentElement?.querySelector('.cdtl_opt_select')))&&!el.closest(excluded));
  const path=el=>{
    const parts=[];for(let node=el;node&&node.nodeType===1;node=node.parentElement){
      parts.unshift(node.tagName.toLowerCase()+':nth-child('+([...(node.parentElement?.children||[])].indexOf(node)+1)+')');
      if(node.tagName==='BODY')break;
    }return parts.join(' > ');
  };
  const groups=selects.flatMap(el=>{
    const label=[el.name,el.id,el.getAttribute('aria-label'),el.title,el.labels?.[0]?.textContent,el.previousElementSibling?.textContent].filter(Boolean).join(' ').trim();
    if(/quantity|qty|수량|배송|사은품|추가\s*구성|정렬|sort/i.test(label))return [];
    if(!/size|color|colour|width|length|option|사이즈|색상|컬러|발볼|기장|옵션|선택/i.test(label+' '+(el.innerText||el.textContent)))return [];
    return [{selector:path(el),label,options:[...el.options].map((o,index)=>({value:o.value,label:String(el.parentElement?.querySelector('.cdtl_select_lst li[data-index="'+index+'"] .txt')?.textContent||o.textContent||'').replace(/\s+/g,' ').trim(),inStock:!o.disabled&&!/품절(?!\s*임박)|매진|SOLD\s*OUT|재고\s*없/i.test(o.textContent),placeholder:!o.value||/^(?:[-=\s]*)(?:.*(?:선택해\s*주세요|선택하세요|선택해주세요)|선택|choose|select)(?:[.\s=-]*)$/i.test(o.textContent)}))}];
  });
  const radioGroups=[...scope.querySelectorAll('[role="radiogroup"]')]
    .filter(el=>visible(el)&&!el.closest(excluded)&&!el.querySelector('[role="radiogroup"]'));
  const radioKeys=new Set();
  const radios=radioGroups.flatMap(el=>{
    const choices=[...el.querySelectorAll('[role="radio"]')];
    if(!choices.length)return [];
    const label=choices[0].getAttribute('data-shp-contents-type')||el.getAttribute('aria-label')||el.parentElement.getAttribute('aria-label')||'';
    if(!/색상|컬러|사이즈|size|color|colour/i.test(label))return [];
    const key=choices[0].getAttribute('data-shp-area-id')||label;
    if(radioKeys.has(key))return [];radioKeys.add(key);
    return [{selector:path(el),kind:'radio',label,options:choices.map(o=>({selector:path(o),label:String(o.getAttribute('aria-label')||o.innerText||o.textContent||'').trim(),inStock:!o.disabled&&o.getAttribute('aria-disabled')!=='true'&&!/품절(?!\s*임박)|매진|SOLD\s*OUT|재고\s*없/i.test(o.textContent)}))}];
  });
  // Standard radio inputs are often visually hidden behind labels. Collect
  // each named group, including mixed radio-colour/native-select-size widgets.
  const inputGroups=new Map();
  for(const el of scope.querySelectorAll('input[type="radio"]')){
    if(el.closest(excluded)||el.closest('[role="radiogroup"]')||!(visible(el)||visible(el.labels?.[0])))continue;
    const name=el.name||el.getAttribute('data-attributename')||'';
    if(!/size|color|colour|width|length|option|사이즈|색상|컬러|발볼|기장|옵션/i.test(name))continue;
    const label=String(el.labels?.[0]?.textContent||el.getAttribute('data-friendly-name')||el.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
    if(!label||/guide|chart|가이드|조견표/i.test(label))continue;
    if(!inputGroups.has(name))inputGroups.set(name,{selector:path(el.parentElement),kind:'radio',label:name,options:[]});
    inputGroups.get(name).options.push({selector:path(el),label,
      inStock:!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!/disabled|unavailable|unselectable|sold.?out/i.test(el.parentElement.className)&&!/품절(?!\s*임박)|매진|SOLD[\s_-]*OUT|재고\s*없/i.test(label)});
  }
  // Accessible custom dropdowns (Naver and React storefronts). Only explicit
  // option controls are traversed; purchase/cart and notification buttons are
  // never clicked. Controls without a discoverable option list remain unknown.
  const controls=[...scope.querySelectorAll('[role="combobox"],[aria-haspopup="listbox"]')]
    .filter(el=>el.tagName!=='SELECT'&&visible(el)&&!el.closest(excluded))
    .filter(el=>!/quantity|qty|수량|정렬|sort|검색|search/i.test([el.textContent,el.getAttribute('aria-label'),el.id].join(' ')))
    .filter((el,index,all)=>{const name=el.querySelector('input')?.name;return !name||all.findIndex(other=>other.querySelector('input')?.name===name)===index;});
  const customGroups=controls.map(el=>{
    const listId=el.getAttribute('aria-controls')||el.getAttribute('aria-owns');
    const list=listId?document.getElementById(listId):el.parentElement?.querySelector('[role="listbox"]');
    const options=list&&visible(list)?[...list.querySelectorAll('[role="option"]')]:[];
    return {selector:path(el),kind:'custom',label:el.getAttribute('aria-label')||el.textContent,
      options:options.map(o=>({selector:path(o),label:String(o.querySelector('.labelTextWrap .caption')?.textContent||o.innerText||o.textContent||'').trim(),stockText:String(o.querySelector('.labelTextWrap .stock')?.textContent||'').trim(),inStock:o.getAttribute('aria-disabled')!=='true'&&!/disabled|sold.?out/i.test(o.className)&&!/품절(?!\s*임박)|매진|SOLD\s*OUT|재고\s*없/i.test(o.textContent)}))};
  });
  // SFCC/Shopify and brand-owned button swatches without ARIA groups. Follow
  // same-page variant controls only; links to another SKU stay separate.
  const swatchContainers=[...scope.querySelectorAll('fieldset,[data-option-name],[data-attribute-name],[data-attr],.swatches')]
    .filter(el=>visible(el)&&!el.closest(excluded)&&!el.matches('.selector-color')&&!el.querySelector('select,input[type="radio"],[role="radiogroup"],[role="combobox"]'));
  const swatches=swatchContainers.flatMap(el=>{
    if(swatchContainers.some(child=>child!==el&&el.contains(child)))return [];
    const label=[el.getAttribute('data-option-name'),el.getAttribute('data-attribute-name'),el.getAttribute('data-attr'),el.querySelector('legend')?.textContent,el.className].filter(Boolean).join(' ');
    if(!/color|colour|size|width|length|색상|컬러|사이즈|기장|발볼/i.test(label))return [];
    const choices=[...el.querySelectorAll('button,a,[role="button"]')].filter(o=>{
      if(!visible(o)||o.closest(excluded)||/guide|chart|가이드|조견표/i.test(o.textContent+' '+o.className))return false;
      if(o.tagName==='A'&&o.getAttribute('href')&&!/^(?:#|javascript:)/i.test(o.getAttribute('href'))){
        try{const url=new URL(o.href,location.href);if(url.origin!==location.origin||url.pathname!==location.pathname)return false;}catch{return false;}
      }
      return true;
    });
    const options=choices.map(o=>({selector:path(o),label:String(o.getAttribute('aria-label')||o.title||o.textContent||o.getAttribute('data-value')||'').replace(/\s+/g,' ').trim(),
      inStock:!o.disabled&&o.getAttribute('aria-disabled')!=='true'&&!/disabled|unselectable|unavailable|sold.?out/i.test(o.className+' '+o.parentElement.className)&&!/품절(?!\s*임박)|매진|SOLD[\s_-]*OUT/i.test(o.textContent)})).filter(o=>o.label);
    return options.length?[{selector:path(el),kind:'swatch',label,options}]:[];
  });
  const combined=[...groups,...radios,...inputGroups.values(),...customGroups,...swatches];
  combined.sort((a,b)=>{
    const color=label=>/color|colour|색상|컬러/i.test(label)?0:1;
    const rank=color(a.label)-color(b.label);if(rank)return rank;
    const left=document.querySelector(a.selector),right=document.querySelector(b.selector);
    return left&&right&&(left.compareDocumentPosition(right)&Node.DOCUMENT_POSITION_FOLLOWING)?-1:1;
  });
  // Related colour links on these stores identify different product codes.
  // Retain the selected colour without opening another SKU under this row.
  const selectedColor=scope.querySelector('.selector-color .variation-color.selected');
  if(combined.length&&!combined.some(g=>/color|colour|색상|컬러/i.test(g.label))&&selectedColor){
    const label=selectedColor.getAttribute('data-color')||selectedColor.getAttribute('aria-label');
    if(label)combined.unshift({selector:path(selectedColor),kind:'static',label:'color',options:[{label,inStock:null}]});
  }
  return {groups:combined};
}
