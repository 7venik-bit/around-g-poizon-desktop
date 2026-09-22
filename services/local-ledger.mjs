import {randomUUID} from 'node:crypto';
import SSF from 'ssf';
import {readLedgerWorkbook,saveLedgerWorkbook,exportLedgerWorkbook,workbookView} from './ledger-workbook.mjs';
import {calculateLedger,formatLedgerValue,ledgerScalar,shiftLedgerFormula} from './ledger-calculation.mjs';
import {updateLedgerXlsx,readLedgerImages} from './ledger-xlsx.mjs';
import {purchaseLedgerImageUrl,validatePurchaseLedgerRow} from './purchase-ledger.mjs';
import {LEDGER_COPY_SCHEMA} from './ledger-clipboard.mjs';
import {autofillLedger,LEDGER_FORMULA_VERSION,ledgerCalculationSheet} from './ledger-autofill.mjs';

const fail=code=>{throw Error(code);};
const empty=()=>({type:'text',value:''});
const blank=raw=>raw?.value==null||String(raw.value).trim()==='';
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
  if(raw.type==='date'&&!SSF.is_date(sheet.numberFormats[row-1][column-1]||'General'))sheet.numberFormats[row-1][column-1]='yyyy-mm-dd';
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

function target(book,input) {
  const sheet=book.sheets.find(s=>s.id===input?.sheetId);
  if(!sheet)fail('CELL_ADDRESS_INVALID');
  if(book.revision!==input.revision)fail('CELL_CONFLICT');
  return sheet;
}
function rectangle(sheet,range) {
  const {row,column,endRow=row,endColumn=column}=range||{};
  if(![row,column,endRow,endColumn].every(Number.isSafeInteger)||row<1||column<1||endRow<row||endColumn<column||endRow>sheet.rowCount||endColumn>sheet.columnCount)fail('CELL_ADDRESS_INVALID');
  if((endRow-row+1)*(endColumn-column+1)>5000)fail('CELL_RANGE_TOO_LARGE');
  return {row,column,endRow,endColumn};
}
function validateChange(sheet,row,column,next) {
  const r=row-1,c=column-1;
  if(sheet.merges?.some(m=>r>=m.row&&r<m.row+m.rows&&c>=m.column&&c<m.column+m.columns&&(r!==m.row||c!==m.column)))fail('CELL_MERGED');
  // Clearing content must work even in a dropdown. Preserve its validation.
  if(next.type==='text'&&next.value==='')return;
  const rule=sheet.validations?.[r]?.[c];
  if(rule?.type==='other')fail('CELL_VALIDATION_REVIEW');
  if(rule?.type==='list'&&!rule.values.includes(next.value))fail('CELL_VALIDATION_FAILED');
}

// The only source migration is the already encrypted, verified local snapshot.
// No network client/configuration is accepted by this service.
export function createLocalLedger({path,sourcePath,encrypt,decrypt,save=saveLedgerWorkbook,read=readLedgerWorkbook,categories}) {
  let queue=Promise.resolve();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const readLocal=async()=>{
    try {return await read(path,decrypt);}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    let book;
    try {book=await read(sourcePath,decrypt);}catch(error){if(error.code==='ENOENT')fail('WORKBOOK_NOT_IMPORTED');throw error;}
    if(book.sheets.some(s=>!Array.isArray(s.rawValues)))fail('WORKBOOK_SOURCE_INCOMPLETE');
    book.local={version:1,migratedAt:new Date().toISOString(),sourceRevision:book.revision,sourceXlsxSha256:book.xlsxSha256};
    book.revision=randomUUID();calculateLedger(book);readLedgerImages(book);
    await save(path,book,encrypt);return await read(path,decrypt);
  };
  const commit=async(book,edits,{manual=true,autofill=true}={})=>{
    if(autofill&&edits.length)edits=[...edits,...autofillLedger(book,{edits,manual,categories:categories?await categories(book):undefined}).edits];
    calculateLedger(book);updateLedgerXlsx(book,edits);
    book.revision=randomUUID();book.local.updatedAt=new Date().toISOString();
    await save(path,book,encrypt);const verified=await read(path,decrypt);
    if(verified.revision!==book.revision)fail('WORKBOOK_SAVE_VERIFY_FAILED');
    return verified;
  };
  const repairDateFormats=async(book)=>{
    const edits=[];
    for(const sheet of book.sheets)for(const [r,values] of (sheet.rawValues||[]).entries())for(const [c,raw] of values.entries())
      if(raw?.type==='date'&&!SSF.is_date(sheet.numberFormats?.[r]?.[c]||'General'))edits.push({sheetId:sheet.id,row:r+1,column:c+1,formatOnly:true});
    if(!edits.length)return book;
    const backupPath=`${path}.before-date-formats-v1.encrypted`;
    try {await read(backupPath,decrypt);}catch(error) {
      if(error.code!=='ENOENT')throw error;
      await save(backupPath,book,encrypt);
      if((await read(backupPath,decrypt)).revision!==book.revision)fail('WORKBOOK_SAVE_VERIFY_FAILED');
    }
    for(const edit of edits) {
      const sheet=book.sheets.find(s=>s.id===edit.sheetId);
      ensureCell(sheet,edit.row,edit.column);sheet.numberFormats[edit.row-1][edit.column-1]='yyyy-mm-dd';
      put(sheet,edit.row,edit.column,sheet.rawValues[edit.row-1][edit.column-1]);
    }
    book.local.dateFormatRepair={at:new Date().toISOString(),backupPath,cells:edits};
    return commit(book,edits,{autofill:false});
  };
  const load=async()=>{
    const book=await readLocal();
    if(book.local?.formulaVersion===LEDGER_FORMULA_VERSION||!book.sheets.some(ledgerCalculationSheet))return repairDateFormats(book);
    // Keep an encrypted, verified pre-repair copy. Never overwrite that recovery
    // point on restart, and never publish a migration whose backup failed.
    const backupPath=`${path}.before-formulas-v${LEDGER_FORMULA_VERSION}.encrypted`;
    try {await read(backupPath,decrypt);}catch(error) {
      if(error.code!=='ENOENT')throw error;
      await save(backupPath,book,encrypt);
      if((await read(backupPath,decrypt)).revision!==book.revision)fail('WORKBOOK_SAVE_VERIFY_FAILED');
    }
    const repair=autofillLedger(book,{repair:true,categories:categories?await categories(book):undefined});
    book.local.formulaVersion=LEDGER_FORMULA_VERSION;
    book.local.formulaRepair={at:new Date().toISOString(),backupPath,changes:repair.audit};
    return repairDateFormats(await commit(book,repair.edits,{autofill:false}));
  };
  const relocateReceipt=async(book,sheet,existing,destination)=>{
    const previousRowNumbers=existing.map(x=>x.row),sources=new Set(previousRowNumbers);
    const rowNumbers=existing.map((_,i)=>destination.row+i),overrides=book.local.formulaOverrides?.[sheet.id]||{};
    const touched=new Set([...previousRowNumbers,...rowNumbers]);
    for(const number of touched)if(sheet.merges?.some(m=>number-1>=m.row&&number-1<m.row+m.rows))fail('PURCHASE_DESTINATION_MERGED');
    for(const number of rowNumbers) {
      if(sources.has(number))continue;
      // Only empty rows with normal gender/status/shipping defaults and formula
      // templates are destinations. Preserve unrelated notes and manual amounts.
      const occupied=sheet.rawValues[number-1]?.some((raw,c)=>!blank(raw)
        &&![4,11,16].includes(c)&&!(raw.type==='formula'&&[6,15,17,18,19,20,21].includes(c)));
      if(occupied||sheet.images?.some(image=>image.row===number)||sheet.notes?.[number-1]?.some(Boolean)
        ||Object.keys(overrides).some(key=>key.startsWith(`${number}:`)))fail('PURCHASE_DESTINATION_OCCUPIED');
    }
    // Snapshot all sources before touching the model, including overlapping moves.
    const snapshots=existing.map(({row})=>({row,raw:structuredClone(sheet.rawValues[row-1]),notes:structuredClone(sheet.notes[row-1]),
      images:structuredClone((sheet.images||[]).filter(image=>image.row===row)),
      overrides:Object.entries(overrides).filter(([key])=>key.startsWith(`${row}:`)),
      category:structuredClone(book.local.categories?.[sheet.id]?.rows?.[row]),fee:structuredClone(book.local.fees?.[sheet.id]?.rows?.[row])}));
    const defaults=rowNumbers.map(number=>sources.has(number)?[]:structuredClone(sheet.rawValues[number-1]||[]));
    const backupPath=`${path}.before-receipt-move-${randomUUID()}.encrypted`;
    await save(backupPath,book,encrypt);
    if((await read(backupPath,decrypt)).revision!==book.revision)fail('WORKBOOK_SAVE_VERIFY_FAILED');
    const edits=[];
    for(const number of touched) {
      for(let column=1;column<=sheet.columnCount;column++) {
        put(sheet,number,column,empty());sheet.notes[number-1][column-1]='';
        edits.push({sheetId:sheet.id,row:number,column,clearNote:true});
        delete overrides[`${number}:${column}`];
      }
      for(const state of [book.local.categories?.[sheet.id],book.local.fees?.[sheet.id]])if(state?.rows)delete state.rows[number];
    }
    sheet.images=(sheet.images||[]).filter(image=>!touched.has(image.row));
    for(const [i,snapshot] of snapshots.entries()) {
      const number=rowNumbers[i];
      for(let column=1;column<=sheet.columnCount;column++) {
        let raw=structuredClone(snapshot.raw?.[column-1]||empty());
        const manuallyCleared=snapshot.overrides.some(([key])=>key===`${snapshot.row}:${column}`);
        if(blank(raw)&&!manuallyCleared&&[5,12,17].includes(column))raw=defaults[i][column-1]||raw;
        if(raw.type==='formula')raw.value=shiftLedgerFormula(raw.value,number-snapshot.row);
        put(sheet,number,column,raw);sheet.notes[number-1][column-1]=snapshot.notes?.[column-1]||'';
        edits.push({sheetId:sheet.id,row:number,column,clearNote:true,image:snapshot.images.find(image=>image.column===column)?.url});
      }
      sheet.images.push(...snapshot.images.map(image=>({...image,row:number})));
      for(const [key,value] of snapshot.overrides)overrides[`${number}:${key.split(':')[1]}`]=value;
      if(snapshot.category)book.local.categories[sheet.id].rows[number]=snapshot.category;
      if(snapshot.fee)book.local.fees[sheet.id].rows[number]=snapshot.fee;
    }
    for(let r=0;r<2;r++)for(let c=0;c<sheet.columnCount;c++) {
      const range=sheet.formulas[r]?.[c]?.match(/^=(SUM|COUNTA|AVERAGE)\((\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)\)$/i);
      if(!range||range[2].replace(/\$/g,'')!==range[4].replace(/\$/g,''))continue;
      const from=Number(range[3]),to=Number(range[5]);
      if(previousRowNumbers.some(n=>n<from||n>to)||rowNumbers.every(n=>n>=from&&n<=to))continue;
      put(sheet,r+1,c+1,{type:'formula',value:`=${range[1]}(${range[2]}${Math.min(from,...rowNumbers)}:${range[4]}${Math.max(to,...rowNumbers)})`});
      edits.push({sheetId:sheet.id,row:r+1,column:c+1});
    }
    (book.local.receiptMoves||=[]).push({at:new Date().toISOString(),sheetId:sheet.id,previousRowNumbers,rowNumbers,backupPath});
    // A cell in an overlapping move is patched exactly once from its final state.
    const finalEdits=[...new Map(edits.map(e=>[`${e.row}:${e.column}`,e])).values()];
    // Relocation keeps the existing category and calculation formulas. It needs
    // recalculation, but no full catalog scan or formula generation for new rows.
    await commit(book,finalEdits,{autofill:false});
    return {ok:true,duplicate:false,moved:true,previousRowNumbers,rowNumber:rowNumbers[0],rowNumbers,
      unitPrices:rowNumbers.map(n=>Number(sheet.rawValues[n-1]?.[13]?.value)),imageStatus:'existing'};
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
      const next=typedInput(edit.next);validateChange(sheet,edit.row,edit.column,next);
      put(sheet,edit.row,edit.column,next);
      sheet.images=sheet.images?.filter(image=>image.row!==edit.row||image.column!==edit.column);
      return workbookView(await commit(book,[edit]));
    }),
    copy:input=>serial(async()=>{
      const book=await load(),sheet=target(book,input),range=rectangle(sheet,input.range),cells=[],images=[];
      for(let r=range.row;r<=range.endRow;r++) {
        const row=[];
        for(let c=range.column;c<=range.endColumn;c++)row.push(structuredClone(sheet.rawValues[r-1]?.[c-1]||empty()));
        cells.push(row);
      }
      for(const image of sheet.images||[])if(image.row>=range.row&&image.row<=range.endRow&&image.column>=range.column&&image.column<=range.endColumn)
        images.push({row:image.row-range.row,column:image.column-range.column,url:image.url});
      return {schema:LEDGER_COPY_SCHEMA,row:range.row,column:range.column,cells,images};
    }),
    change:input=>serial(async()=>{
      const book=await load(),sheet=target(book,input),range=rectangle(sheet,input.range),edits=[];
      if(input.action==='clear') {
        for(let row=range.row;row<=range.endRow;row++)for(let column=range.column;column<=range.endColumn;column++)edits.push({sheetId:sheet.id,row,column,next:empty()});
      } else if(input.action==='paste') {
        const payload=input.payload,cells=payload?.cells;
        if(payload?.schema!==LEDGER_COPY_SCHEMA||!Array.isArray(cells)||!cells.length||!Array.isArray(cells[0])||!cells[0].length||cells.length*cells[0].length>5000||cells.some(row=>!Array.isArray(row)||row.length!==cells[0].length))fail('CELL_CLIPBOARD_INVALID');
        const height=cells.length,width=cells[0].length;
        // A single copied cell fills the selected range; a block starts at its top left.
        const endRow=height===1&&width===1?range.endRow:range.row+height-1,endColumn=height===1&&width===1?range.endColumn:range.column+width-1;
        rectangle(sheet,{...range,endRow,endColumn});
        for(let row=range.row;row<=endRow;row++)for(let column=range.column;column<=endColumn;column++) {
          const r=(row-range.row)%height,c=(column-range.column)%width,raw={...cells[r][c]};
          if(raw.type==='formula'&&Number.isSafeInteger(payload.row)&&Number.isSafeInteger(payload.column))raw.value=shiftLedgerFormula(raw.value,row-payload.row-r,column-payload.column-c);
          if(raw.type==='date'&&/T/.test(raw.value)) {
            const instant=Date.parse(raw.value);if(!Number.isFinite(instant))fail('CELL_DATE_INVALID');
            raw.value=new Date(instant+9*3600000).toISOString().slice(0,10);
          }
          const image=payload.images?.find(image=>image.row===r&&image.column===c);
          if(image&&(!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(image.url)||image.url.length>10000000))fail('CELL_CLIPBOARD_INVALID');
          edits.push({sheetId:sheet.id,row,column,next:typedInput(raw),image:image?.url});
        }
      } else fail('CELL_ACTION_INVALID');
      // Validate the entire selection before changing any cell or committing a file.
      for(const edit of edits)validateChange(sheet,edit.row,edit.column,edit.next);
      for(const edit of edits) {
        put(sheet,edit.row,edit.column,edit.next);
        sheet.images=(sheet.images||[]).filter(image=>image.row!==edit.row||image.column!==edit.column);
        if(edit.image)sheet.images.push({row:edit.row,column:edit.column,url:edit.image});
      }
      return workbookView(await commit(book,edits));
    }),
    resize:input=>serial(async()=>{
      const book=await load(),sheet=target(book,input),changes=input.changes;
      if(!Array.isArray(changes)||!changes.length||changes.length>2000)fail('CELL_DIMENSION_INVALID');
      for(const {axis,index,pixels} of changes) {
        const limit=axis==='column'?sheet.columnCount:axis==='row'?sheet.rowCount:0;
        if(!Number.isSafeInteger(index)||index<1||index>limit||!Number.isInteger(pixels)||pixels<(axis==='column'?32:24)||pixels>(axis==='column'?600:400))fail('CELL_DIMENSION_INVALID');
      }
      for(const {axis,index,pixels} of changes)(sheet[axis==='column'?'columnWidths':'rowHeights']||={})[index]=pixels;
      return workbookView(await commit(book,[]));
    }),
    record:(row,destination,{existingOnly=false}={})=>serial(async()=>{
      if(!validatePurchaseLedgerRow(row).ok)fail('REQUIRED_FIELDS_MISSING');
      const quantity=Number(row.quantity),total=Number(row.purchasePrice);
      if(!Number.isInteger(quantity)||quantity<1||quantity>1000||!Number.isSafeInteger(total)||total<quantity)fail('PURCHASE_UNITS_INVALID');
      const order=String(row.orderNumber||'').trim(),line=String(row.orderEvidence?.orderLineId||'').trim();
      if(!order||!line)fail('ORDER_EVIDENCE_REQUIRED');
      const key=JSON.stringify([order,line]),book=await load(),sheet=book.sheets.find(s=>s.name==='1-구매완료');
      if(!sheet||sheet.columnCount<14)fail('WORKBOOK_PURCHASE_SHEET_MISSING');
      if(destination) {
        if(destination.sheetId!==sheet.id||!Number.isSafeInteger(destination.row)||destination.row<3||destination.row+quantity-1>sheet.rowCount)fail('PURCHASE_DESTINATION_INVALID');
        if(destination.revision!==book.revision)fail('CELL_CONFLICT');
      }
      const existing=[];
      for(let r=0;r<(sheet.notes?.length||0);r++) {
        try {const note=JSON.parse(sheet.notes[r]?.[7]||'');if(note.schema==='around-g.purchase.units.v1'&&note.key===key)existing.push({row:r+1,note});}catch{}
      }
      if(existing.length) {
        if(existing.length!==quantity||existing.some(x=>x.note.quantity!==quantity||x.note.total!==total||!Number.isInteger(x.note.unit)||x.note.unit<1||x.note.unit>quantity)||new Set(existing.map(x=>x.note.unit)).size!==quantity)fail('PURCHASE_EXISTING_CONFLICT');
        const rowNumbers=existing.sort((a,b)=>a.note.unit-b.note.unit).map(x=>x.row);
        if(destination&&rowNumbers.some((number,i)=>number!==destination.row+i))return relocateReceipt(book,sheet,existing,destination);
        return {ok:true,duplicate:true,rowNumber:rowNumbers[0],rowNumbers,unitPrices:rowNumbers.map(n=>Number(sheet.rawValues[n-1]?.[13]?.value)),imageStatus:'existing'};
      }
      if(existingOnly)fail('PURCHASE_EXISTING_NOT_FOUND');
      let last=1,template=-1;
      for(let r=2;r<sheet.displayValues.length;r++) {
        if(sheet.rawValues[r]?.some((v,c)=>v?.value!==''&&v?.value!=null && (v.type!=='formula'||c!==6)))last=r;
        if(sheet.rawValues[r]?.[2]?.value&&sheet.formulas[r]?.slice(14).some(Boolean))template=r;
      }
      const start=destination?destination.row-1:last+1;
      if(destination) {
        // Defaults (gender/status/shipping) and calculation formulas can exist in
        // a free purchase row. Product data, photos and receipt notes cannot.
        const productColumns=[0,1,2,3,5,6,7,8,9,10,12,13,14];
        for(let r=start;r<start+quantity;r++) {
          const occupied=productColumns.some(c=>{const raw=sheet.rawValues[r]?.[c];return !blank(raw)&&!(c===6&&raw.type==='formula');});
          if(occupied||sheet.images?.some(image=>image.row===r+1)||sheet.notes?.[r]?.some(Boolean))fail('PURCHASE_DESTINATION_OCCUPIED');
          if(sheet.merges?.some(m=>r>=m.row&&r<m.row+m.rows))fail('PURCHASE_DESTINATION_MERGED');
        }
        // Prefer the closest preceding product as the formula template. Rows
        // recorded farther down the sheet must not dictate this row's formulas.
        const preceding=sheet.rawValues.slice(2,start).findLastIndex((values,index)=>values?.[2]?.value&&sheet.formulas[index+2]?.slice(14).some(Boolean));
        if(preceding>=0)template=preceding+2;
      }
      const prices=Array.from({length:quantity},(_,i)=>Math.floor(total/quantity)+(i<total%quantity?1:0)),edits=[],rowNumbers=[];
      for(let i=0;i<quantity;i++) {
        const r=start+i,number=r+1;rowNumbers.push(number);ensureCell(sheet,number,sheet.columnCount);
        if(!destination&&template>=0)for(const field of ['numberFormats','backgrounds','fontColors','fontWeights','validations'])sheet[field][r]=structuredClone(sheet[field][template]);
        const text=value=>({type:'text',value:String(value||'')});
        const values=[text(row.brand),text(row.purchaseUrl),text(row.articleNumber),text(row.modelName),text(row.gender),text(row.euSize),text(row.krSize),{type:'formula',value:`=IMAGE("${purchaseLedgerImageUrl(row.imageUrl).replace(/"/g,'%22')}",1)`},empty(),empty(),empty(),text(row.status||'구매완료'),typedInput({type:'date',value:row.purchaseDate}),{type:'number',value:String(prices[i])}];
        sheet.numberFormats[r][12] ||= 'm/d';
        for(let c=0;c<sheet.columnCount;c++) {
          if(destination) {
            // Keep the selected row's fees, formulas, formatting and manual
            // defaults. Only fill purchase fields and missing formula cells.
            if([8,9,10].includes(c)||(c===4&&!row.gender))continue;
            if(c>=14&&(!blank(sheet.rawValues[r]?.[c])||!sheet.formulas[template]?.[c]))continue;
          }
          const raw=c<14?values[c]:template>=0&&sheet.formulas[template]?.[c]?{type:'formula',value:shiftLedgerFormula(sheet.formulas[template][c],r-template)}:empty();
          put(sheet,number,c+1,raw);edits.push({sheetId:sheet.id,row:number,column:c+1,...(!destination&&{templateRow:template+1})});
        }
        sheet.notes[r][7]=JSON.stringify({schema:'around-g.purchase.units.v1',key,unit:i+1,quantity,total});
      }
      sheet.rowCount=Math.max(sheet.rowCount,rowNumbers.at(-1));
      // Extend simple header totals when appending beyond their last data row.
      // Migration itself leaves every original formula unchanged.
      for(let r=0;r<Math.min(2,sheet.formulas.length);r++)for(let c=0;c<sheet.formulas[r].length;c++) {
        const formula=sheet.formulas[r][c],range=formula.match(/^=(SUM|COUNTA|AVERAGE)\((\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)\)$/i);
        if(!range||range[2].replace(/\$/g,'')!==range[4].replace(/\$/g,'')||Number(range[3])<3||Number(range[5])<Math.max(3,template+1)||Number(range[5])>last+1||Number(range[5])>=rowNumbers.at(-1))continue;
        put(sheet,r+1,c+1,{type:'formula',value:`=${range[1]}(${range[2]}${range[3]}:${range[4]}${rowNumbers.at(-1)})`});
        edits.push({sheetId:sheet.id,row:r+1,column:c+1});
      }
      await commit(book,edits,{manual:false});
      return {ok:true,duplicate:false,rowNumber:rowNumbers[0],rowNumbers,unitPrices:prices,imageStatus:'formula'};
    })
  };
}
