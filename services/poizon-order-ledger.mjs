import SSF from 'ssf';
import {formatLedgerValue,ledgerScalar,shiftLedgerFormula} from './ledger-calculation.mjs';

const fields=['displayValues','formulas','rawValues','numberFormats','backgrounds','fontColors','fontWeights','validations','notes'];
const raw=(sheet,row,column)=>sheet.rawValues?.[row-1]?.[column-1];
const value=(sheet,row,column)=>String(raw(sheet,row,column)?.value??'').trim();
const blank=cell=>cell?.value==null||String(cell.value).trim()==='';
const norm=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const colorNames=[['블랙','BLACK','BLK','BLKO'],['화이트','WHITE','WHT','WHTO'],['베이지','BEIGE','BEGO'],['그레이','GREY','GRAY','GRY'],['네이비','NAVY','NVY'],['레드','RED'],['블루','BLUE'],['핑크','PINK'],['브라운','BROWN'],['그린','GREEN']];
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
  return order?.status==='거래 성공'&&order?.route==='일반판매'&&/^\d{10,25}$/.test(String(order.orderNumber||''))
    &&norm(order.articleNumber).length>=5&&/^\d{4}-\d\d-\d\d$/.test(order.saleDate||'')
    &&Number.isSafeInteger(order.salePrice)&&order.salePrice>0
    &&Number.isSafeInteger(order.income)&&order.income>=0&&order.income<=order.salePrice
    &&Number.isInteger(order.quantity)&&order.quantity===1;
}
function matchingRows(sheet,order) {
  const key=norm(order.articleNumber),size=norm(order.size).replace(/^SIZE/,'');
  const matched=[];
  for(let row=3;row<=sheet.rawValues.length;row++) {
    const article=norm(value(sheet,row,3)),name=norm(value(sheet,row,4));
    if(article!==key&&!(article===''&&name.includes(key)&&key.length>=7))continue;
    if(colorConflict(value(sheet,row,4),order.color))continue;
    if(/(?:\d+\s*개|\d+\s*PCS)/i.test(value(sheet,row,4)))continue; // grouped purchase cannot represent one sale
    const rowSize=norm(value(sheet,row,6)||value(sheet,row,7)).replace(/^SIZE/,'');
    if(size&&rowSize&&size!==rowSize)continue;
    const existingPrice=raw(sheet,row,10),existingDate=raw(sheet,row,11);
    if(!blank(existingPrice)&&money(existingPrice)!==order.salePrice)continue;
    if(!blank(existingDate)&&datePart(existingDate)!==order.saleDate)continue;
    matched.push(row);
  }
  return matched;
}
function sameSale(sheet,row,order) {
  const article=norm(value(sheet,row,3)),name=norm(value(sheet,row,4)),key=norm(order.articleNumber);
  const size=norm(order.size).replace(/^SIZE/,''),rowSize=norm(value(sheet,row,6)||value(sheet,row,7)).replace(/^SIZE/,'');
  return (article===key||article===''&&key.length>=7&&name.includes(key))
    &&!colorConflict(value(sheet,row,4),order.color)
    &&(!size||!rowSize||size===rowSize)
    &&money(raw(sheet,row,10))===order.salePrice&&datePart(raw(sheet,row,11))===order.saleDate;
}
function orderNote(order) {
  return JSON.stringify({schema:'around-g.poizon.sale.v1',orderNumber:order.orderNumber,
    salePrice:order.salePrice,income:order.income,fee:order.salePrice-order.income,
    saleDate:order.saleDate,articleNumber:order.articleNumber,size:order.size||'',source:'POIZON 판매자센터 · 주문 내역'});
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

// Mutates an in-memory workbook only. Caller commits all edits atomically after
// the complete seller-center scan; ambiguous matches remain untouched.
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
    if(!validOrder(order)) {review.push({orderNumber:id,reason:order?.failure||'거래 성공·일반판매·금액·체결일 검증 필요'});continue;}
    const linked=links[id];
    const candidates=linked?[linked.purchaseRow]:matchingRows(purchase,order).filter(row=>!usedPurchase.has(row));
    if(candidates.length!==1||!Number.isInteger(candidates[0])){review.push({orderNumber:id,reason:candidates.length?'구매 행이 여러 개입니다':'일치하는 단일 구매 행이 없습니다'});continue;}
    const row=candidates[0],actual=matchingRows(purchase,order);
    if(!actual.includes(row)){review.push({orderNumber:id,reason:'기존 판매 값과 주문 상세가 다릅니다'});continue;}
    const existingSales=linked?[linked.salesRow]:Array.from({length:Math.max(sales.rawValues.length,3)-2},(_,i)=>i+3).filter(n=>existingNote(sales,n)===id||sameSale(sales,n,order));
    if(existingSales.length>1||linked&&(!Number.isInteger(existingSales[0])||!sameSale(sales,existingSales[0],order))){review.push({orderNumber:id,reason:'판매완료 행 확인 필요'});continue;}
    const salesRow=existingSales[0]||firstFreeRow(sales),templateRow=lastProductRow(sales)||undefined;
    if(!existingSales.length&&[1,3,4,10,11,14].some(column=>!blank(raw(sales,salesRow,column)))){review.push({orderNumber:id,reason:'판매완료 입력 위치가 사용 중입니다'});continue;}
    if([[purchase,row],[sales,salesRow]].some(([sheet,targetRow])=>{
      const fee=raw(sheet,targetRow,16);
      return fee&&!blank(fee)&&fee.type==='number'&&money(fee)!==order.salePrice-order.income;
    })){review.push({orderNumber:id,reason:'기존 수수료와 주문 상세가 다릅니다'});continue;}
    if([[purchase,row],[sales,salesRow]].some(([sheet,targetRow])=>{
      const prior=existingNote(sheet,targetRow),current=sheet.notes?.[targetRow-1]?.[9]||'';
      return prior&&prior!==id||!prior&&current&&current!==orderNote(order);
    })){review.push({orderNumber:id,reason:'판매가 셀에 다른 주문 메모가 있습니다'});continue;}
    const fee=order.salePrice-order.income,source=structuredClone(purchase.rawValues[row-1]||[]),sourceNotes=structuredClone(purchase.notes?.[row-1]||[]);
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
      }
    }
    if(existingSales.length) {
      if(blank(raw(sales,salesRow,16))||raw(sales,salesRow,16)?.type==='formula')write(sales,salesRow,16,number(fee),edits);
    }
    for(const [sheet,targetRow] of [[purchase,row],[sales,salesRow]]) {
      const prior=existingNote(sheet,targetRow);
      if(!prior) {
        ensure(sheet,targetRow,10);sheet.notes[targetRow-1][9]=orderNote(order);
        edits.push({sheetId:sheet.id,row:targetRow,column:10});
      }
      (book.local.formulaOverrides||={})[sheet.id]||={};
      book.local.formulaOverrides[sheet.id][`${targetRow}:16`]=true;
    }
    links[id]={purchaseRow:row,salesRow,salePrice:order.salePrice,saleDate:order.saleDate,fee};
    usedPurchase.add(row);if(!linked||edits.some(edit=>edit.row===row&&edit.sheetId===purchase.id||edit.row===salesRow&&edit.sheetId===sales.id))recorded.push({orderNumber:id,purchaseRow:row,salesRow});
  }
  book.local.poizonOrders=links;
  return {edits,recorded,review};
}
