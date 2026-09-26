import SSF from 'ssf';
import {formatLedgerValue,ledgerScalar,shiftLedgerFormula} from './ledger-calculation.mjs';

const fields=['displayValues','formulas','rawValues','numberFormats','backgrounds','fontColors','fontWeights','validations','notes'];
const raw=(sheet,row,column)=>sheet.rawValues?.[row-1]?.[column-1];
const value=(sheet,row,column)=>String(raw(sheet,row,column)?.value??'').trim();
const blank=cell=>cell?.value==null||String(cell.value).trim()==='';
const norm=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const sizeKey=text=>{
  const key=norm(String(text||'').split(/[·,/|]/).at(-1).replace(/^(?:SIZE|EU|KR|US)\s*/i,''));
  return key==='ONESIZE'?'ONE':key;
};
const sizeMatches=(sheet,row,order)=>{
  const size=sizeKey(order.size);
  if(!size)return true;
  const choices=[value(sheet,row,6),value(sheet,row,7)].map(sizeKey).filter(Boolean);
  return !choices.length||choices.includes(size);
};
const colorNames=[['블랙','BLACK','BLK','BLKO','BLK0'],['화이트','WHITE','WHT','WHTO','WHT0'],['베이지','BEIGE','BEGO'],['그레이','GREY','GRAY','GRY'],['네이비','NAVY','NVY'],['레드','RED'],['블루','BLUE'],['핑크','PINK'],['브라운','BROWN'],['그린','GREEN']];
function articleMatches(article,order) {
  const key=norm(order.articleNumber);
  if(article===key)return true;
  if(key.length<8||!article.startsWith(key))return false;
  const suffix=article.slice(key.length),group=colorNames.find(tokens=>tokens.includes(suffix));
  return Boolean(group&&group.some(token=>String(order.color||'').toUpperCase().includes(token)));
}
function colorConflict(name,option) {
  if(!option)return false;
  const fromName=colorNames.find(group=>group.some(token=>name.toUpperCase().includes(token)));
  return Boolean(fromName&&!fromName.some(token=>option.toUpperCase().includes(token)));
}
const datePart=cell=>cell?.type==='date'?new Date(Date.parse(cell.value)+9*3600000).toISOString().slice(0,10):String(cell?.value||'').slice(0,10);
const money=cell=>Number(String(cell?.value??'').replace(/[₩,\s]/g,''));
const empty=()=>({type:'text',value:''});
const number=n=>({type:'number',value:String(n)});
const date=s=>({type:'date',value:new Date(`${s}T00:00:00+09:00`).toISOString()});
const saleFormats={17:'"₩"#,##0',18:'"₩"#,##0',19:'"₩"#,##0.00',20:'"₩"#,##0.00',21:'0.00%',22:'0.00%'};
function applySaleFormats(sheet,row,edits) {
  for(const [columnText,format] of Object.entries(saleFormats)) {
    const column=Number(columnText),current=sheet.numberFormats?.[row-1]?.[column-1];
    if(current&&current!=='General')continue;
    ensure(sheet,row,column);sheet.numberFormats[row-1][column-1]=format;
    const cell=raw(sheet,row,column);
    if(cell?.type!=='formula')sheet.displayValues[row-1][column-1]=formatLedgerValue(ledgerScalar(cell),format);
    edits.push({sheetId:sheet.id,row,column,formatOnly:true});
  }
}
// Repair previously linked seller orders on workbook load as well as during a
// seller scan. Existing orders may be skipped by incremental scans.
export function repairPoizonSaleFormats(book) {
  const purchase=book.sheets.find(s=>s.name==='1-구매완료'),sales=book.sheets.find(s=>s.name==='5-판매완료');
  if(!purchase||!sales)return [];
  const edits=[];
  for(const [id,link] of Object.entries(book.local?.poizonOrders||{}))
    for(const [sheet,row] of [[purchase,link?.purchaseRow],[sales,link?.salesRow]])
      if(Number.isInteger(row)&&row>=3&&existingNote(sheet,row)===id)applySaleFormats(sheet,row,edits);
  return edits;
}
function ensure(sheet,row,column) {
  for(const field of fields) {
    sheet[field]||=[];
    while(sheet[field].length<row)sheet[field].push([]);
    while(sheet[field][row-1].length<column)sheet[field][row-1].push(field==='rawValues'?empty():field==='validations'?null:'');
  }
  sheet.rowCount=Math.max(sheet.rowCount||0,row);
}
function write(sheet,row,column,next,edits,extras={}) {
  ensure(sheet,row,column);
  sheet.rawValues[row-1][column-1]=next;
  sheet.formulas[row-1][column-1]=next.type==='formula'?next.value:'';
  if(next.type==='date'&&!SSF.is_date(sheet.numberFormats[row-1][column-1]||'General'))sheet.numberFormats[row-1][column-1]='yyyy-mm-dd';
  sheet.displayValues[row-1][column-1]=next.type==='formula'?'':formatLedgerValue(ledgerScalar(next),sheet.numberFormats[row-1][column-1]);
  edits.push({sheetId:sheet.id,row,column,...extras});
}
function validOrder(order) {
  return ['거래 성공','발송 대기','발송 완료','판매자 발송 완료'].includes(order?.status)&&order?.route==='일반판매'&&/^\d{10,25}$/.test(String(order.orderNumber||''))
    &&norm(order.articleNumber).length>=5&&Boolean(order.size||order.packaging)&&Boolean(order.imageUrl)
    &&/^\d{4}-\d\d-\d\d$/.test(order.saleDate||'')
    &&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(order.buyerPaidAt||'')
    &&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(order.orderClosedAt||'')
    &&order.orderClosedAt.slice(0,10)===order.saleDate
    &&Number.isSafeInteger(order.salePrice)&&order.salePrice>0
    &&Number.isSafeInteger(order.basicFee)&&order.basicFee>=0&&order.basicFee<=order.salePrice
    &&Number.isSafeInteger(order.freightFee)&&order.freightFee>=0&&order.freightFee<=order.salePrice-order.basicFee
    &&Number.isSafeInteger(order.income)&&order.income>=0&&order.income<=order.salePrice
    &&order.income<=order.salePrice-order.basicFee-order.freightFee
    &&Number.isInteger(order.quantity)&&order.quantity===1;
}
function matchingRows(sheet,order) {
  const key=norm(order.articleNumber);
  const matched=[];
  for(let row=3;row<=sheet.rawValues.length;row++) {
    const article=norm(value(sheet,row,3)),name=norm(value(sheet,row,4));
    if(!articleMatches(article,order)&&!(article===''&&name.includes(key)&&key.length>=7))continue;
    if(colorConflict(`${value(sheet,row,4)} ${value(sheet,row,7)}`,order.color))continue;
    if(/(?:\d+\s*개|\d+\s*PCS)/i.test(value(sheet,row,4)))continue; // grouped purchase cannot represent one sale
    if(!sizeMatches(sheet,row,order))continue;
    const existingPrice=raw(sheet,row,10),existingDate=raw(sheet,row,11);
    if(!blank(existingPrice)&&money(existingPrice)!==order.salePrice)continue;
    if(!blank(existingDate)&&datePart(existingDate)!==order.saleDate)continue;
    matched.push(row);
  }
  return matched;
}
function sameSale(sheet,row,order) {
  const article=norm(value(sheet,row,3)),name=norm(value(sheet,row,4)),key=norm(order.articleNumber);
  return (articleMatches(article,order)||article===''&&key.length>=7&&name.includes(key))
    &&!colorConflict(`${value(sheet,row,4)} ${value(sheet,row,7)}`,order.color)
    &&sizeMatches(sheet,row,order)
    &&money(raw(sheet,row,10))===order.salePrice&&datePart(raw(sheet,row,11))===order.saleDate;
}
function orderNote(order) {
  return JSON.stringify({schema:'around-g.poizon.sale.v1',orderNumber:order.orderNumber,
    salePrice:order.salePrice,income:order.income,fee:order.basicFee,freightFee:order.freightFee,
    saleDate:order.saleDate,buyerPaidAt:order.buyerPaidAt,orderClosedAt:order.orderClosedAt,
    articleNumber:order.articleNumber,size:order.size||'',packaging:order.packaging||'',color:order.color||'',imageUrl:order.imageUrl,
    source:'POIZON 판매자센터 · 주문 내역'});
}
function existingNote(sheet,row) {
  try {const note=JSON.parse(sheet.notes?.[row-1]?.[9]||'');return note.schema==='around-g.poizon.sale.v1'?note.orderNumber:'';}catch{return '';}
}
function lastProductRow(sheet) {
  let last=0;
  for(let row=3;row<=sheet.rawValues.length;row++)if([1,3,4,10,11,14].some(column=>!blank(raw(sheet,row,column))))last=row;
  return last;
}
function firstFreeRow(sheet) {
  for(let row=Math.max(3,lastProductRow(sheet)+1);row<=Math.max(sheet.rowCount||0,sheet.rawValues.length)+1;row++) {
    if(sheet.merges?.some(m=>row-1>=m.row&&row-1<m.row+m.rows))continue;
    if(sheet.images?.some(image=>image.row===row)||sheet.notes?.[row-1]?.some(Boolean))continue;
    const occupied=sheet.rawValues?.[row-1]?.some((cell,index)=>!blank(cell)&&cell.type!=='formula'&&![4,11].includes(index));
    if(!occupied)return row;
  }
  throw Error('POIZON_SALES_DESTINATION_FULL');
}

// Mutates an in-memory workbook only. Caller commits each completed seller-center
// page; rows with conflicting sale evidence remain untouched.
export function reconcilePoizonOrders(book,orders) {
  if(!Array.isArray(orders)||orders.length>10000)throw Error('POIZON_ORDERS_INVALID');
  const purchase=book.sheets.find(s=>s.name==='1-구매완료'),sales=book.sheets.find(s=>s.name==='5-판매완료');
  if(!purchase||!sales||purchase.columnCount<22||sales.columnCount<22)throw Error('POIZON_LEDGER_SHEETS_MISSING');
  book.local||={};const links=book.local.poizonOrders||={};
  const edits=[],review=[],recorded=[],usedPurchase=new Set(Object.values(links).map(x=>x?.purchaseRow));
  const seen=new Set();
  for(const order of orders) {
    const id=String(order?.orderNumber||'');
    if(seen.has(id)){review.push({orderNumber:id,reason:'중복 주문번호'});continue;}seen.add(id);
    if(!validOrder(order)) {review.push({orderNumber:id,reason:order?.failure||'판매 진행 상태·일반판매·금액·체결일 검증 필요'});continue;}
    const linked=links[id];
    const candidates=linked?[linked.purchaseRow]:matchingRows(purchase,order).filter(row=>!usedPurchase.has(row));
    const noted=candidates.filter(row=>existingNote(purchase,row)===id);
    const available=candidates.filter(row=>blank(raw(purchase,row,10))&&blank(raw(purchase,row,11))&&!existingNote(purchase,row));
    const row=linked?candidates[0]:noted.length===1?noted[0]:candidates.length===1?candidates[0]
      :noted.length===0&&available.length===candidates.length?available[0]:undefined;
    if(!Number.isInteger(row)){review.push({orderNumber:id,reason:candidates.length?'구매 행이 여러 개이거나 기존 판매값과 충돌합니다':'일치하는 구매 행이 없습니다'});continue;}
    const actual=matchingRows(purchase,order);
    if(!actual.includes(row)){review.push({orderNumber:id,reason:'기존 판매 값과 주문 상세가 다릅니다'});continue;}
    const existingSales=linked?[linked.salesRow]:Array.from({length:Math.max(sales.rawValues.length,3)-2},(_,i)=>i+3).filter(n=>{
      const prior=existingNote(sales,n);
      return prior===id||!prior&&sameSale(sales,n,order);
    });
    if(existingSales.length>1||linked&&(!Number.isInteger(existingSales[0])||!sameSale(sales,existingSales[0],order))){review.push({orderNumber:id,reason:'판매완료 행 확인 필요'});continue;}
    const salesRow=existingSales[0]||firstFreeRow(sales),templateRow=lastProductRow(sales)||undefined;
    if(existingSales.length&&!['','구매완료','일판완료'].includes(value(sales,salesRow,12))){review.push({orderNumber:id,reason:'판매완료 상태 확인 필요'});continue;}
    if(!existingSales.length&&[1,3,4,10,11,14].some(column=>!blank(raw(sales,salesRow,column)))){review.push({orderNumber:id,reason:'판매완료 입력 위치가 사용 중입니다'});continue;}
    if([[purchase,row],[sales,salesRow]].some(([sheet,targetRow])=>{
      const fee=raw(sheet,targetRow,16);
      return fee&&!blank(fee)&&fee.type==='number'&&money(fee)!==order.basicFee;
    })){review.push({orderNumber:id,reason:'기존 수수료와 주문 상세가 다릅니다'});continue;}
    if([[purchase,row],[sales,salesRow]].some(([sheet,targetRow])=>{
      const prior=existingNote(sheet,targetRow),current=sheet.notes?.[targetRow-1]?.[9]||'';
      return prior&&prior!==id||!prior&&current&&current!==orderNote(order);
    })){review.push({orderNumber:id,reason:'판매가 셀에 다른 주문 메모가 있습니다'});continue;}
    const fee=order.basicFee,freight=order.freightFee,source=structuredClone(purchase.rawValues[row-1]||[]),sourceNotes=structuredClone(purchase.notes?.[row-1]||[]);
    const sourceImages=structuredClone((purchase.images||[]).filter(image=>image.row===row));
    for(const sheet of [purchase,...(existingSales.length?[]:[sales])]) {
      const targetRow=sheet===purchase?row:salesRow;
      ensure(sheet,targetRow,Math.max(sheet.columnCount,source.length));
      if(sheet===sales) {
        for(const field of ['numberFormats','backgrounds','fontColors','fontWeights'])sheet[field][targetRow-1]=structuredClone(purchase[field]?.[row-1]||[]);
        for(let column=1;column<=Math.min(sheet.columnCount,source.length);column++) {
          let next=structuredClone(source[column-1]||empty());
          if(next.type==='formula')next.value=shiftLedgerFormula(next.value,salesRow-row);
          if(column===10)next=number(order.salePrice);
          if(column===11)next=date(order.saleDate);
          if(column===12)next={type:'text',value:'일판완료'};
          if(column===16)next=number(fee);
          if(column===17)next=number(freight);
          const image=sourceImages.find(x=>x.column===column)?.url;
          write(sheet,targetRow,column,next,edits,{templateRow,...(image?{image}:{})});
          sheet.notes[targetRow-1][column-1]=sourceNotes[column-1]||'';
          if(image)(sheet.images||=[]).push({row:targetRow,column,url:image});
        }
      } else {
        if(blank(raw(sheet,row,10)))write(sheet,row,10,number(order.salePrice),edits);
        if(blank(raw(sheet,row,11)))write(sheet,row,11,date(order.saleDate),edits);
        const status=value(sheet,row,12),rule=sheet.validations?.[row-1]?.[11];
        if((!status||status==='구매완료')&&(!rule||rule.type==='list'&&rule.values?.includes('일판완료')))
          write(sheet,row,12,{type:'text',value:'일판완료'},edits);
        if(blank(raw(sheet,row,16))||raw(sheet,row,16)?.type==='formula')write(sheet,row,16,number(fee),edits);
        if(raw(sheet,row,17)?.type!=='number'||money(raw(sheet,row,17))!==freight)write(sheet,row,17,number(freight),edits);
      }
    }
    if(existingSales.length) {
      if(value(sales,salesRow,12)!=='일판완료')write(sales,salesRow,12,{type:'text',value:'일판완료'},edits);
      if(blank(raw(sales,salesRow,16))||raw(sales,salesRow,16)?.type==='formula')write(sales,salesRow,16,number(fee),edits);
      if(raw(sales,salesRow,17)?.type!=='number'||money(raw(sales,salesRow,17))!==freight)write(sales,salesRow,17,number(freight),edits);
    }
    for(const [sheet,targetRow] of [[purchase,row],[sales,salesRow]]) {
      if(sheet.notes?.[targetRow-1]?.[9]!==orderNote(order)) {
        ensure(sheet,targetRow,10);sheet.notes[targetRow-1][9]=orderNote(order);
        edits.push({sheetId:sheet.id,row:targetRow,column:10});
      }
      (book.local.formulaOverrides||={})[sheet.id]||={};
      book.local.formulaOverrides[sheet.id][`${targetRow}:16`]=true;
      book.local.formulaOverrides[sheet.id][`${targetRow}:17`]=true;
      applySaleFormats(sheet,targetRow,edits);
    }
    links[id]={purchaseRow:row,salesRow,salePrice:order.salePrice,saleDate:order.saleDate,fee,freight};
    usedPurchase.add(row);if(!linked||edits.some(edit=>!edit.formatOnly&&(edit.row===row&&edit.sheetId===purchase.id||edit.row===salesRow&&edit.sheetId===sales.id)))recorded.push({orderNumber:id,purchaseRow:row,salesRow});
  }
  book.local.poizonOrders=links;
  return {edits,recorded,review};
}

export function verifyPoizonRecordedSales(book,orders,recorded) {
  const purchase=book.sheets.find(sheet=>sheet.name==='1-구매완료');
  const sales=book.sheets.find(sheet=>sheet.name==='5-판매완료');
  const byNumber=new Map(orders.map(order=>[String(order.orderNumber),order]));
  if(!purchase||!sales)throw Error('POIZON_LEDGER_SAVE_VERIFY_FAILED');
  for(const entry of recorded) {
    const order=byNumber.get(entry.orderNumber),link=book.local?.poizonOrders?.[entry.orderNumber];
    const fee=order?.basicFee,freight=order?.freightFee;
    if(!order||!link||link.purchaseRow!==entry.purchaseRow||link.salesRow!==entry.salesRow
      ||!sameSale(purchase,entry.purchaseRow,order)||!sameSale(sales,entry.salesRow,order)
      ||money(raw(purchase,entry.purchaseRow,16))!==fee||money(raw(sales,entry.salesRow,16))!==fee
      ||money(raw(purchase,entry.purchaseRow,17))!==freight||money(raw(sales,entry.salesRow,17))!==freight
      ||value(sales,entry.salesRow,12)!=='일판완료'
      ||existingNote(purchase,entry.purchaseRow)!==entry.orderNumber
      ||existingNote(sales,entry.salesRow)!==entry.orderNumber
      ||purchase.notes?.[entry.purchaseRow-1]?.[9]!==orderNote(order)
      ||sales.notes?.[entry.salesRow-1]?.[9]!==orderNote(order))
      throw Error(`POIZON_LEDGER_SAVE_VERIFY_FAILED:${entry.orderNumber}`);
  }
  return recorded.length;
}

