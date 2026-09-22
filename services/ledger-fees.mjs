// User-supplied POIZON fee table (22678.jpg, supplied 2026-09-22).
// This is a saved local policy, not a live Google Drive or seller API lookup.
export const LEDGER_FEE_SOURCE='사용자 제공 POIZON 수수료표 · 2026-09-22';
export const LEDGER_FEE_GROUPS=[
  {label:'가방 및 캐리어·시계·액세서리',rate:0.14,minimum:18000,maximum:45000,
    aliases:['가방','가방류','가방및캐리어','가방 및 캐리어','캐리어','시계','시계류','악세사리','악세사리류','액세서리','액세서리류','패션 액세서리']},
  {label:'일반 카테고리',rate:0.10,minimum:15000,maximum:45000,
    aliases:['신발','신발류','의류','여성 의류','남성 의류','뷰티','뷰티제품','완구악기','완구악기류','완구·악기류','운동아웃도어','운동·아웃도어','주류','가구','가구류','3C전자제품','3c전자제품','전자제품','건강식품','식품','식품류','기타']},
];
export function ledgerFeePolicy(category) {
  const root=String(category??'').split('/')[0].trim().replace(/ +/g,' ');
  return LEDGER_FEE_GROUPS.find(group=>group.aliases.includes(root))||null;
}
export function ledgerFeeFormula(row,categoryColumn) {
  const price=`J${row}`,category=`${categoryColumn}${row}`;
  const root=`TRIM(LEFT(${category},FIND("/",${category}&"/")-1))`;
  let expression='""';
  for(const group of [...LEDGER_FEE_GROUPS].reverse()) {
    const match=`OR(${group.aliases.map(alias=>`${root}="${alias}"`).join(',')})`;
    // IF comparisons work in both the embedded parser and native Excel.
    const amount=`ROUND((${price}*1)*${group.rate},0)`;
    expression=`IF(${match},IF(${amount}>${group.maximum},${group.maximum},IF(${amount}<${group.minimum},${group.minimum},${amount})),${expression})`;
  }
  return `=IF(LEN(TRIM(${price}&""))=0,"",IF((${price}*1)<=0,"",${expression}))`;
}
