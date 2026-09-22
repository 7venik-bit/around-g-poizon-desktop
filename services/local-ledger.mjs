import {randomUUID} from 'node:crypto';
import {readLedgerWorkbook,saveLedgerWorkbook,exportLedgerWorkbook,workbookView} from './ledger-workbook.mjs';
import {calculateLedger,formatLedgerValue,ledgerScalar,shiftLedgerFormula} from './ledger-calculation.mjs';
import {updateLedgerXlsx,readLedgerImages} from './ledger-xlsx.mjs';
import {purchaseLedgerImageUrl,validatePurchaseLedgerRow} from './purchase-ledger.mjs';

const fail=code=>{throw Error(code);};
const empty=()=>({type:'text',value:''});
const fields=['displayValues','formulas','rawValues','numberFormats','backgrounds','fontColors','fontWeights','validations','notes'];
function ensureCell(sheet,row,col) {
  for(const field of fields) {
    sheet[field] ||= [];
    while(sheet[field].length<row)sheet[field].push([]);
    for(let r=0;r<row;r++)while(sheet[field][r].length<Math.max(col,sheet.columnCount || 0))sheet[field][r].push(field==='rawValues'?empty():field==='validations'?null:'');
  }
}
function put(sheet,row,column,raw) {
  ensureCell(sheet,row,column);sheet.rawValues[row-1][column-1]=raw;
  sheet.formulas[row-1][column-1]=raw.type==='formula'?raw.value:'';
  sheet.displayValues[row-1][column-1]=raw.type==='formula'?'':formatLedgerValue(ledgerScalar(raw),sheet.numberFormats[row-1][column-1]);
}
function typedInput(input) {
  if(!input||typeof input.value!=='string'||input.value.length>50000)fail('CELL_VALUE_INVALID');
  const {type,value}=input;
  if(type==='number') {
    if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)||value.replace(/[-.]/g,'').replace(/^0+/,'').length>15||!Number.isFinite(Number(value)))fail('CELL_NUMBER_INVALID');
  } else if(type==='boolean') {if(!['true','false'].includes(value))fail('CELL_VALUE_INVALID');}
  else if(type==='date') {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('CELL_DATE_INVALID');
    return {type,value:new Date(value+'T00:00:00+09:00').toISOString()};
  } else if(type==='formula') {if(!value.startsWith('='))fail('CELL_FORMULA_INVALID');}
  else if(type!=='text')fail('CELL_VALUE_INVALID');
  return {type,value};
}

// The only source migration is the already encrypted, verified local snapshot.
// No network client/configuration is accepted by this service.
export function createLocalLedger({path,sourcePath,encrypt,decrypt,save=saveLedgerWorkbook,read=readLedgerWorkbook}) {
  let queue=Promise.resolve();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const load=async()=>{
    try {return await read(path,decrypt);}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    let book;
    try {book=await read(sourcePath,decrypt);}catch(error){if(error.code==='ENOENT')fail('WORKBOOK_NOT_IMPORTED');throw error;}
    if(book.sheets.some(s=>!Array.isArray(s.rawValues)))fail('WORKBOOK_SOURCE_INCOMPLETE');
    book.local={version:1,migratedAt:new Date().toISOString(),sourceRevision:book.revision,sourceXlsxSha256:book.xlsxSha256};
    book.revision=randomUUID();calculateLedger(book);readLedgerImages(book);
    await save(path,book,encrypt);return await read(path,decrypt);
  };
  const commit=async(book,edits)=>{
    calculateLedger(book);updateLedgerXlsx(book,edits);
    book.revision=randomUUID();book.local.updatedAt=new Date().toISOString();
    await save(path,book,encrypt);const verified=await read(path,decrypt);
    if(verified.revision!==book.revision)fail('WORKBOOK_SAVE_VERIFY_FAILED');
    return verified;
  };
  return {
    load:()=>serial(load),
    view:()=>serial(async()=>workbookView(await load())),
    export:destination=>serial(async()=>exportLedgerWorkbook(destination,await load())),
    edit:edit=>serial(async()=>{
      const book=await load(),sheet=book.sheets.find(s=>s.id===edit?.sheetId);
      if(!sheet||!Number.isInteger(edit.row)||!Number.isInteger(edit.column)||edit.row<1||edit.column<1||edit.row>sheet.rowCount||edit.column>sheet.columnCount)fail('CELL_ADDRESS_INVALID');
      const r=edit.row-1,c=edit.column-1,current=sheet.rawValues[r]?.[c]||empty();
      if(book.revision!==edit.revision||current.type!==edit.expected?.type||current.value!==edit.expected?.value)fail('CELL_CONFLICT');
      if(sheet.merges?.some(m=>r>=m.row&&r<m.row+m.rows&&c>=m.column&&c<m.column+m.columns&&(r!==m.row||c!==m.column)))fail('CELL_MERGED');
      const next=typedInput(edit.next),rule=sheet.validations?.[r]?.[c];
      if(rule?.type==='other')fail('CELL_VALIDATION_REVIEW');
      if(rule?.type==='list'&&!rule.values.includes(next.value))fail('CELL_VALIDATION_FAILED');
      put(sheet,edit.row,edit.column,next);
      sheet.images=sheet.images?.filter(image=>image.row!==edit.row||image.column!==edit.column);
      return workbookView(await commit(book,[edit]));
    }),
    record:row=>serial(async()=>{
      if(!validatePurchaseLedgerRow(row).ok)fail('REQUIRED_FIELDS_MISSING');
      const quantity=Number(row.quantity),total=Number(row.purchasePrice);
      if(!Number.isInteger(quantity)||quantity<1||quantity>1000||!Number.isSafeInteger(total)||total<quantity)fail('PURCHASE_UNITS_INVALID');
      const order=String(row.orderNumber||'').trim(),line=String(row.orderEvidence?.orderLineId||'').trim();
      if(!order||!line)fail('ORDER_EVIDENCE_REQUIRED');
      const key=JSON.stringify([order,line]),book=await load(),sheet=book.sheets.find(s=>s.name==='1-구매완료');
      if(!sheet||sheet.columnCount<14)fail('WORKBOOK_PURCHASE_SHEET_MISSING');
      const existing=[];
      for(let r=0;r<(sheet.notes?.length||0);r++) {
        try {const note=JSON.parse(sheet.notes[r]?.[7]||'');if(note.schema==='around-g.purchase.units.v1'&&note.key===key)existing.push({row:r+1,note});}catch{}
      }
      if(existing.length) {
        if(existing.length!==quantity||existing.some(x=>x.note.quantity!==quantity||x.note.total!==total)||new Set(existing.map(x=>x.note.unit)).size!==quantity)fail('PURCHASE_EXISTING_CONFLICT');
        const rowNumbers=existing.sort((a,b)=>a.note.unit-b.note.unit).map(x=>x.row);
        return {ok:true,duplicate:true,rowNumber:rowNumbers[0],rowNumbers,unitPrices:rowNumbers.map(n=>Number(sheet.rawValues[n-1]?.[13]?.value)),imageStatus:'existing'};
      }
      let last=1,template=-1;
      for(let r=2;r<sheet.displayValues.length;r++) {
        if(sheet.rawValues[r]?.some((v,c)=>v?.value!==''&&v?.value!=null && (v.type!=='formula'||c!==6)))last=r;
        if(sheet.rawValues[r]?.[2]?.value&&sheet.formulas[r]?.slice(14).some(Boolean))template=r;
      }
      const prices=Array.from({length:quantity},(_,i)=>Math.floor(total/quantity)+(i<total%quantity?1:0)),edits=[],rowNumbers=[];
      for(let i=0;i<quantity;i++) {
        const r=last+i+1,number=r+1;rowNumbers.push(number);ensureCell(sheet,number,sheet.columnCount);
        if(template>=0)for(const field of ['numberFormats','backgrounds','fontColors','fontWeights','validations'])sheet[field][r]=structuredClone(sheet[field][template]);
        const text=value=>({type:'text',value:String(value||'')});
        const values=[text(row.brand),text(row.purchaseUrl),text(row.articleNumber),text(row.modelName),text(row.gender),text(row.euSize),text(row.krSize),{type:'formula',value:`=IMAGE("${purchaseLedgerImageUrl(row.imageUrl).replace(/"/g,'%22')}",1)`},empty(),empty(),empty(),text(row.status||'구매완료'),typedInput({type:'date',value:row.purchaseDate}),{type:'number',value:String(prices[i])}];
        sheet.numberFormats[r][12] ||= 'm/d';
        for(let c=0;c<sheet.columnCount;c++) {
          const raw=c<14?values[c]:template>=0&&sheet.formulas[template]?.[c]?{type:'formula',value:shiftLedgerFormula(sheet.formulas[template][c],r-template)}:empty();
          put(sheet,number,c+1,raw);edits.push({sheetId:sheet.id,row:number,column:c+1,templateRow:template+1});
        }
        sheet.notes[r][7]=JSON.stringify({schema:'around-g.purchase.units.v1',key,unit:i+1,quantity,total});
      }
      sheet.rowCount=Math.max(sheet.rowCount,rowNumbers.at(-1));
      // Extend simple header totals when appending beyond their last data row.
      // Migration itself leaves every original formula unchanged.
      for(let r=0;r<Math.min(2,sheet.formulas.length);r++)for(let c=0;c<sheet.formulas[r].length;c++) {
        const formula=sheet.formulas[r][c],range=formula.match(/^=(SUM|COUNTA|AVERAGE)\((\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)\)$/i);
        if(!range||range[2].replace(/\$/g,'')!==range[4].replace(/\$/g,'')||Number(range[3])<3||Number(range[5])<Math.max(3,template+1)||Number(range[5])>last+1)continue;
        put(sheet,r+1,c+1,{type:'formula',value:`=${range[1]}(${range[2]}${range[3]}:${range[4]}${rowNumbers.at(-1)})`});
        edits.push({sheetId:sheet.id,row:r+1,column:c+1});
      }
      await commit(book,edits);
      return {ok:true,duplicate:false,rowNumber:rowNumbers[0],rowNumbers,unitPrices:prices,imageStatus:'formula'};
    })
  };
}
