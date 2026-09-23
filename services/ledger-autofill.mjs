import {ledgerColumnName} from './ledger-calculation.mjs';
import {ledgerArticleKey,ledgerCategoryIndex} from './ledger-categories.mjs';
import {ledgerFeeFormula,ledgerFeePolicy,LEDGER_FEE_SOURCE} from './ledger-fees.mjs';

export const LEDGER_FORMULA_VERSION=3;
const compact=value=>String(value??'').replace(/\s/g,'');
const valueAt=(sheet,r,c)=>sheet.rawValues?.[r-1]?.[c-1]?.value??sheet.displayValues?.[r-1]?.[c-1]??'';
const rawAt=(sheet,r,c)=>sheet.rawValues?.[r-1]?.[c-1]||{type:'text',value:''};
const blank=value=>String(value??'').trim()==='';
const calculationColumns=[16,18,19,20,21,22];
const editableFormulaColumns=[7,...calculationColumns];
const sizeFormula=row=>`=IFERROR(IF(E${row}="여성",VLOOKUP(F${row},'사이즈'!$B$4:$E$24,2,FALSE),VLOOKUP(F${row},'사이즈'!$G$4:$J$24,2,FALSE)),"")`;
const legacySizeFormula=formula=>/^=\s*(?:IFERROR\s*\()?\s*IF\s*\(.*VLOOKUP\s*\(.*'사이즈'!/i.test(formula);
function sizeLookupAvailable(book,sheet,row) {
  const lookup=book.sheets.find(s=>s.name==='사이즈');
  const size=String(valueAt(sheet,row,6)).trim();
  if(!lookup||!size)return false;
  const keyColumn=String(valueAt(sheet,row,5)).trim()==='여성'?2:7;
  return Array.from({length:21},(_,i)=>i+4).some(r=>String(valueAt(lookup,r,keyColumn)).trim()===size);
}

// Only the original transaction-table layout is eligible. Other worksheets,
// arbitrary user formulas and the size lookup are not calculation templates.
export function ledgerCalculationSheet(sheet) {
  const expected={3:/^품번$/,4:/^모델명$/,10:/^판매가(?:\(원화\))?$/,14:/^구매가(?:\(원화\))?$/,16:/^예상수수료$/,17:/^택배비$/,18:/^(?:간이|기본)마진$/,19:/^부가세환급$/,20:/^(?:일반|최종)마진$/,21:/^구매가비마진율$/,22:/^판매가비마진율$/};
  return Object.entries(expected).every(([c,pattern])=>pattern.test(compact(valueAt(sheet,2,Number(c)))));
}
export function ledgerProductRow(sheet,row) {
  return [2,3,4].some(c=>!blank(valueAt(sheet,row,c)));
}
const missing=ref=>`LEN(TRIM(${ref}&""))=0`;
const guard=(refs,expression)=>`=IF(OR(${refs.map(missing).join(',')}),"",${expression})`;
export function ledgerRowFormulas(row,categoryColumn=23) {
  const j=`J${row}`,n=`N${row}`,p=`P${row}`,q=`Q${row}`,r=`R${row}`,s=`S${row}`,t=`T${row}`;
  return {
    16:ledgerFeeFormula(row,ledgerColumnName(categoryColumn-1)),
    18:guard([j,n,p,q],`(${j}*1)-(${n}*1)-(${p}*1)-(${q}*1)`),
    19:guard([n],`((${n}*1)/1.1)*0.1`),
    20:guard([r,s],`${r}+${s}`),
    21:guard([t,n],`IF((${n}*1)=0,"",${t}/(${n}*1))`),
    22:guard([t,j],`IF((${j}*1)=0,"",${t}/(${j}*1))`),
  };
}
// Recognize the imported template family, including the observed K/date and
// cross-row copy errors. Do not replace an unrelated, intentional custom formula.
export function isLegacyLedgerFormula(formula,column) {
  const shape=compact(formula).toUpperCase().replace(/\$?([A-Z]+)\$?\d+/g,'$1#');
  const patterns={
    16:[/^=IF\(([JK])#="","",IF\(\1#<150000,15000,\1#\*0\.1\)\)$/],
    18:[/^=IF\(([JK])#="","",\1#-N#-P#-Q#\)$/],
    19:[/^=\(N#\/1\.1\)\*0\.(?:1|11)$/,/^=IF\(N#="","",\(N#\/1\.1\)\*0\.1\)$/],
    20:[/^=R#\+S#$/,/^=IF\(R#="","",R#\+S#\)$/],
    21:[/^=T#\/N#$/,/^=IFERROR\(T#\/N#,""\)$/,/^=IF\(J#="","",T#\/N#\)$/],
    22:[/^=IF\(([JK])#="","",T#\/\1#\)$/],
  };
  return (patterns[column]||[]).some(pattern=>pattern.test(shape));
}

function write(sheet,row,column,raw,edits) {
  const fields=['rawValues','formulas','displayValues','numberFormats','notes'];
  for(const field of fields) {
    sheet[field]||=[];
    while(sheet[field].length<row)sheet[field].push([]);
    for(let r=0;r<row;r++)while(sheet[field][r].length<sheet.columnCount)sheet[field][r].push(field==='rawValues'?{type:'text',value:''}:'');
  }
  sheet.rawValues[row-1][column-1]=raw;
  sheet.formulas[row-1][column-1]=raw.type==='formula'?raw.value:'';
  sheet.displayValues[row-1][column-1]=raw.type==='formula'?'':raw.value;
  edits.push({sheetId:sheet.id,row,column});
}

export function autofillLedger(book,{repair=false,edits:inputEdits=[],manual=true,categories}={}) {
  const edits=[],audit=[];
  book.local||={};book.local.formulaOverrides||={};
  const resolveCategory=categories?ledgerCategoryIndex(categories):null;
  book.local.categories||={};
  book.local.fees||={};
  for(const sheet of book.sheets) {
    if(!ledgerCalculationSheet(sheet))continue;
    const overrides=book.local.formulaOverrides[sheet.id]||={};
    const changed=inputEdits.filter(e=>e.sheetId===sheet.id);
    const categoryState=book.local.categories[sheet.id]||={rows:{}};
    const feeState=book.local.fees[sheet.id]||={rows:{}};
    if(!categoryState.column) {
      // Use the first truly empty trailing column, never overwrite user data.
      let c=sheet.rawValues[1]?.findIndex((raw,index)=>index>=22&&compact(raw?.value)==='카테고리')+1;
      if(!c){c=23;while(c<=sheet.columnCount&&sheet.rawValues.some(row=>!blank(row[c-1]?.value)))c++;}
      categoryState.column=c;sheet.columnCount=Math.max(sheet.columnCount,c);
      write(sheet,2,c,{type:'text',value:'카테고리'},edits);
      (sheet.columnWidths||={})[c]=150;
    }
    // Direct edits (including Delete) are explicit overrides. Other row edits
    // must never silently re-create a calculation the user deliberately cleared.
    if(manual)for(const e of changed)if(e.row>2&&editableFormulaColumns.includes(e.column))overrides[`${e.row}:${e.column}`]=true;
    const rows=repair?Array.from({length:sheet.rawValues.length-2},(_,i)=>i+3):[...new Set(changed.map(e=>e.row).filter(r=>r>2))];
    for(const row of rows) {
      const product=ledgerProductRow(sheet,row),formulas=ledgerRowFormulas(row,categoryState.column);
      const sizeRaw=rawAt(sheet,row,7),sizeExisting=sheet.formulas?.[row-1]?.[6]||'';
      const sizeReferences=[...sizeExisting.matchAll(/\b[EF](\d+)\b/g)].map(match=>Number(match[1]));
      if(product&&!overrides[`${row}:7`]&&sizeLookupAvailable(book,sheet,row)
        &&(blank(sizeRaw.value)||legacySizeFormula(sizeExisting)&&sizeReferences.some(reference=>reference!==row))) {
        const next=sizeFormula(row);
        if(sizeExisting!==next) {
          write(sheet,row,7,{type:'formula',value:next},edits);
          audit.push({sheetId:sheet.id,cell:'G'+row,before:sizeRaw,after:next,reason:'missing-size-lookup'});
        }
      }
      if(repair)for(const column of [10,14,16,17,18,19,20]) {
        const raw=rawAt(sheet,row,column);
        // Earlier versions saved typed money as text. Repair only unambiguous
        // numeric money cells, so native Excel SUM includes those amounts too.
        if(raw.type==='text'&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw.value)&&raw.value.replace(/[-.]/g,'').length<=15) {
          write(sheet,row,column,{type:'number',value:raw.value},edits);
          audit.push({sheetId:sheet.id,cell:ledgerColumnName(column-1)+row,before:raw,after:raw.value,reason:'numeric-money-text'});
        }
      }
      if(product&&categoryState.column) {
        const c=categoryState.column,key=ledgerArticleKey(valueAt(sheet,row,3)),previous=categoryState.rows[row];
        const manualCategory=(manual&&changed.some(e=>e.row===row&&e.column===c))||(!previous&&!blank(valueAt(sheet,row,c)));
        if(manualCategory)categoryState.rows[row]={key,category:String(valueAt(sheet,row,c)),source:'직접 입력',status:'manual'};
        else if(resolveCategory&&previous?.status!=='manual') {
          const match=resolveCategory(valueAt(sheet,row,3));
          if(!(match.status==='missing'&&previous?.key===key&&previous?.status==='matched')) {
            if(String(valueAt(sheet,row,c))!==match.category)write(sheet,row,c,{type:'text',value:match.category},edits);
            categoryState.rows[row]={key,...match};
          }
        }
      }
      for(const column of calculationColumns) {
        const old=rawAt(sheet,row,column),formula=sheet.formulas?.[row-1]?.[column-1]||'';
        const legacy=isLegacyLedgerFormula(formula,column);
        if(column===16) {
          const policy=ledgerFeePolicy(valueAt(sheet,row,categoryState.column));
          const previousTemplate=guard([`J${row}`],`IF((J${row}*1)<150000,15000,(J${row}*1)*0.1)`);
          const managed=legacy||formula===previousTemplate||formula===formulas[column]||blank(old.value)||(old.type==='number'&&policy);
          const automatic=!overrides[`${row}:${column}`]&&managed;
          if(product)feeState.rows[row]={status:automatic?(policy?'automatic':'category-required'):'manual',
            source:LEDGER_FEE_SOURCE,...(policy?{rate:policy.rate,minimum:policy.minimum,maximum:policy.maximum}:{})};
          if(!automatic||(!product&&!legacy&&formula!==previousTemplate))continue;
          const next=formulas[column];if(next===formula)continue;
          write(sheet,row,column,{type:'formula',value:next},edits);
          audit.push({sheetId:sheet.id,cell:'P'+row,before:old,after:next,reason:'category-fee-policy'});
          continue;
        }
        if(overrides[`${row}:${column}`]||(!legacy&&(!product||!blank(old.value))))continue;
        // Keep defaults on unused rows without making them point at purchases far
        // below. No new formulas are created on an entirely empty product row.
        if(!legacy&&!product)continue;
        const next=formulas[column];if(next===formula)continue;
        write(sheet,row,column,{type:'formula',value:next},edits);
        audit.push({sheetId:sheet.id,cell:ledgerColumnName(column-1)+row,before:old,after:next,reason:legacy?'template-repair':'missing-formula'});
      }
    }
    if(repair) {
      const totalRow=sheet.formulas?.[0]||[],hasTotals=totalRow.some(f=>/^=SUM\([ST]\d+:[ST]\d+\)$/i.test(f));
      if(hasTotals) {
        for(const c of [10,14,19,20,21,22]) {
          const old=rawAt(sheet,1,c),f=totalRow[c-1]||'',letter=ledgerColumnName(c-1);
          let next;
          if([10,14].includes(c)&&blank(old.value))next=`=SUM(${letter}3:${letter}${sheet.rowCount})`;
          else if(new RegExp(`^=SUM\\(${letter}\\d+:${letter}\\d+\\)$`,'i').test(f))next=`=SUM(${letter}3:${letter}${sheet.rowCount})`;
          else if(c===21&&compact(f).toUpperCase()==='=T1/N1')next=ledgerRowFormulas(1)[21];
          else if(c===22&&['=T1/J1','=IF(J1="","",T1/J1)'].includes(compact(f).toUpperCase()))next=ledgerRowFormulas(1)[22];
          else if([21,22].includes(c)) {
            const average=compact(f).toUpperCase().match(new RegExp(`^=AVERAGE\\((${letter}\\d+:${letter}\\d+)\\)$`));
            // A category awaiting review leaves its rate blank. Keep the user's
            // average calculation, but don't divide an empty range. SUM still
            // propagates genuine cell errors when no numeric rate is available.
            if(average)next=`=IF(COUNT(${average[1]})=0,IF(SUM(${average[1]})=0,"",""),AVERAGE(${average[1]}))`;
          }
          if(next&&next!==f){write(sheet,1,c,{type:'formula',value:next},edits);audit.push({sheetId:sheet.id,cell:letter+'1',before:old,after:next,reason:'summary-formula'});}
        }
      }
    }
  }
  return {edits,audit};
}
