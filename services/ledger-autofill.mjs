import {ledgerColumnName} from './ledger-calculation.mjs';
import {ledgerArticleKey,ledgerCategoryIndex} from './ledger-categories.mjs';

export const LEDGER_FORMULA_VERSION=1;
const compact=value=>String(value??'').replace(/\s/g,'');
const valueAt=(sheet,r,c)=>sheet.rawValues?.[r-1]?.[c-1]?.value??sheet.displayValues?.[r-1]?.[c-1]??'';
const rawAt=(sheet,r,c)=>sheet.rawValues?.[r-1]?.[c-1]||{type:'text',value:''};
const blank=value=>String(value??'').trim()==='';
const calculationColumns=[16,18,19,20,21,22];

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
export function ledgerRowFormulas(row) {
  const j=`J${row}`,n=`N${row}`,p=`P${row}`,q=`Q${row}`,r=`R${row}`,s=`S${row}`,t=`T${row}`;
  return {
    16:guard([j],`IF((${j}*1)<150000,15000,(${j}*1)*0.1)`),
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
  for(const sheet of book.sheets) {
    if(!ledgerCalculationSheet(sheet))continue;
    const overrides=book.local.formulaOverrides[sheet.id]||={};
    const changed=inputEdits.filter(e=>e.sheetId===sheet.id);
    const categoryState=book.local.categories[sheet.id]||={rows:{}};
    if(resolveCategory&&!categoryState.column) {
      // Use the first truly empty trailing column, never overwrite user data.
      let c=23;
      while(c<=sheet.columnCount&&sheet.rawValues.some(row=>!blank(row[c-1]?.value)))c++;
      categoryState.column=c;sheet.columnCount=Math.max(sheet.columnCount,c);
      write(sheet,2,c,{type:'text',value:'카테고리'},edits);
      (sheet.columnWidths||={})[c]=150;
    }
    // Direct edits (including Delete) are explicit overrides. Other row edits
    // must never silently re-create a calculation the user deliberately cleared.
    if(manual)for(const e of changed)if(e.row>2&&calculationColumns.includes(e.column))overrides[`${e.row}:${e.column}`]=true;
    const rows=repair?Array.from({length:sheet.rawValues.length-2},(_,i)=>i+3):[...new Set(changed.map(e=>e.row).filter(r=>r>2))];
    for(const row of rows) {
      const product=ledgerProductRow(sheet,row),formulas=ledgerRowFormulas(row);
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
        const manualCategory=manual&&changed.some(e=>e.row===row&&e.column===c);
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
          if(next&&next!==f){write(sheet,1,c,{type:'formula',value:next},edits);audit.push({sheetId:sheet.id,cell:letter+'1',before:old,after:next,reason:'summary-formula'});}
        }
      }
    }
  }
  return {edits,audit};
}
