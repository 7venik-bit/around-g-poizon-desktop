import FormulaParser from 'fast-formula-parser';
import SSF from 'ssf';

const {FormulaError}=FormulaParser;
const standardFunctions=new FormulaParser().functions;
const aggregate=(name,args)=>args.flatMap(arg=>[arg.value].flat(Infinity)).find(v=>v instanceof FormulaError) || standardFunctions[name](...args);
const numeric=FormulaParser.FormulaHelpers.acceptNumber;
// Sheets arithmetic treats empty cells as zero, but whitespace text is not money.
FormulaParser.FormulaHelpers.acceptNumber=function(value,...args) {
  if(value==='')return 0;
  if(typeof value==='string' && !value.trim())throw FormulaError.VALUE;
  return numeric.call(this,value,...args);
};
export const ledgerColumnName=n=>{let out='';for(n++;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
export function ledgerScalar(raw) {
  if(!raw)return '';
  if(raw.type==='number')return Number(raw.value);
  if(raw.type==='boolean')return raw.value==='true';
  if(raw.type==='date')return (Date.parse(raw.value)+9*3600000)/86400000+25569;
  return String(raw.value);
}
export function formatLedgerValue(value,format='General') {
  if(value==null)return '';
  if(value instanceof FormulaError)return value.name;
  if(typeof value==='boolean')return value?'TRUE':'FALSE';
  if(typeof value!=='number')return String(value);
  try {return SSF.format(format || 'General',value);}catch{return String(value);}
}
export function calculateLedger(book) {
  const sheets=new Map(book.sheets.map(sheet=>[sheet.name,sheet])),memo=new Map(),visiting=new Set(),parsers=[];
  const nonempty=(sheet,row,col)=>{
    const target=sheets.get(sheet);
    return Boolean(target?.formulas?.[row-1]?.[col-1]) || (target?.rawValues?.[row-1]?.[col-1]?.value ?? target?.displayValues?.[row-1]?.[col-1] ?? '')!=='';
  };
  const countA=(...args)=>args.reduce((count,arg)=>{
    if(!arg.ref)return count+(arg.omitted?0:[arg.value].flat(Infinity).filter(v=>v!=null).length);
    if(arg.ref.row)return count+Number(nonempty(arg.ref.sheet,arg.ref.row,arg.ref.col));
    const ref=arg.ref,target=sheets.get(ref.sheet);if(!target)throw FormulaError.REF;
    for(let row=ref.from.row;row<=Math.min(ref.to.row,target.rowCount);row++)for(let col=ref.from.col;col<=Math.min(ref.to.col,target.columnCount);col++)count+=Number(nonempty(ref.sheet,row,col));
    return count;
  },0);
  let depth=0,reads=0;
  const cell=(name,row,col)=>{
    const sheet=sheets.get(name),key=JSON.stringify([name,row,col]);
    if(!sheet||row<1||col<1)return FormulaError.REF;
    if(memo.has(key))return memo.get(key);
    if(visiting.has(key))return new FormulaError('#REF!','Circular reference');
    if(++reads>200000||depth>200)return FormulaError.NUM;
    const formula=sheet.formulas?.[row-1]?.[col-1];
    if(!formula)return ledgerScalar(sheet.rawValues?.[row-1]?.[col-1] || {type:'text',value:sheet.displayValues?.[row-1]?.[col-1] || ''});
    // IMAGE stays a local display/export formula. It never makes a calculation-time request.
    if(/^=IMAGE\(/i.test(formula)){memo.set(key,'');return '';}
    visiting.add(key);const level=depth++;
    let value;
    try {
      // Each recursion level owns a parser: nested lookups must not reset a parent's parser state.
      parsers[level] ||= new FormulaParser({
        functions:{WEBSERVICE:()=>FormulaError.NAME,HYPERLINK:()=>FormulaError.NAME,
          SUM:(...args)=>aggregate('SUM',args),AVERAGE:(...args)=>aggregate('AVERAGE',args),COUNTA:countA},
        onVariable:()=>{throw FormulaError.NAME;},
        onCell:ref=>cell(ref.sheet,ref.row,ref.col),
        onRange:ref=>{
          const target=sheets.get(ref.sheet);if(!target)throw FormulaError.REF;
          const lastRow=Math.min(ref.to.row,target.rowCount || target.displayValues.length);
          const lastCol=Math.min(ref.to.col,target.columnCount || Math.max(0,...target.displayValues.map(r=>r.length)));
          if((lastRow-ref.from.row+1)*(lastCol-ref.from.col+1)>100000)throw FormulaError.NUM;
          return Array.from({length:Math.max(0,lastRow-ref.from.row+1)},(_,r)=>
            Array.from({length:Math.max(0,lastCol-ref.from.col+1)},(_,c)=>cell(ref.sheet,ref.from.row+r,ref.from.col+c)));
        }
      });
      if(!parsers[level].funsPreserveRef.includes('COUNTA'))parsers[level].funsPreserveRef.push('COUNTA');
      value=parsers[level].parse(formula.slice(1),{sheet:name,row,col});
      if(typeof value==='number'&&!Number.isFinite(value))value=FormulaError.NUM;
      if(Array.isArray(value))value=FormulaError.VALUE;
    } catch(error){value=error instanceof FormulaError?error:FormulaError.VALUE;}
    finally {depth--;visiting.delete(key);}
    memo.set(key,value);return value;
  };
  const results=[],errors=[];
  for(const sheet of book.sheets) {
    sheet.calculatedValues=[];
    for(let r=0;r<sheet.formulas.length;r++)for(let c=0;c<sheet.formulas[r].length;c++) {
      if(!sheet.formulas[r][c])continue;
      const value=cell(sheet.name,r+1,c+1),error=value instanceof FormulaError;
      const result={sheetId:sheet.id,row:r+1,column:c+1,value:error?value.name:value,type:error?'error':typeof value};
      (sheet.calculatedValues[r] ||= [])[c]={type:result.type,value:result.value};
      (sheet.displayValues[r] ||= [])[c]=formatLedgerValue(value,sheet.numberFormats?.[r]?.[c]);
      results.push(result);if(error)errors.push({sheetId:sheet.id,row:r+1,column:c+1,code:value.name});
    }
  }
  book.calculation={formulaCount:results.length,errorCount:errors.length,errors,calculatedAt:new Date().toISOString()};
  return results;
}

// Fill-down preserves quoted text/URLs, quoted sheet names and absolute row references.
export function shiftLedgerFormula(formula,offset,columnOffset=0) {
  return formula.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.]*!|(?<![A-Za-z0-9_.])(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)(?![A-Za-z0-9_.!(])/g,(whole,absoluteColumn,column,absoluteRow,row)=>{
    if(row===undefined)return whole;
    const nextRow=Number(row)+(absoluteRow?0:offset);
    const nextColumn=[...column.toUpperCase()].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)+(absoluteColumn?0:columnOffset);
    return nextRow>0&&nextRow<=1048576&&nextColumn>0&&nextColumn<=16384?`${absoluteColumn}${ledgerColumnName(nextColumn-1)}${absoluteRow}${nextRow}`:'#REF!';
  });
}
