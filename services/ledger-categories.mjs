export const ledgerArticleKey=value=>String(value??'').trim().toUpperCase().replace(/\s*\(\d+개\)\s*$/,'').replace(/-(?:服|鞋)$/,'').replace(/[\s-]/g,'');

// An exact article lookup may have several colour/size rows, but all matches
// must agree on their category. A conflict is not resolved by first-file order.
export function ledgerCategoryIndex(products) {
  const index=new Map();
  for(const product of products) {
    const key=ledgerArticleKey(product.articleNumber),category=String(product.categoryName??'').trim();
    if(!key||!category)continue;
    const candidates=index.get(key)||new Map();
    candidates.set(category,{category,source:String(product.source??'저장된 POIZON Excel')});index.set(key,candidates);
  }
  return article=>{
    const candidates=index.get(ledgerArticleKey(article));
    return candidates?.size===1?{...candidates.values().next().value,status:'matched'}:{category:'',status:candidates?.size?'conflict':'missing'};
  };
}
