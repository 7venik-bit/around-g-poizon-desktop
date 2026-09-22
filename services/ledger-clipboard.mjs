// Clipboard data is user input. Keep external text literal; only our explicit
// typed copy preserves formulas, dates and leading-zero article numbers.
export const LEDGER_COPY_SCHEMA='aroundg.ledger.cells.v1';
const MAX_TEXT=16000000;
export function ledgerClipboardData(payload) {
  const quote=value=>/[\t\r\n"]/.test(value)?`"${value.replace(/"/g,'""')}"`:value;
  const text=payload.cells.map(row=>row.map(cell=>quote(cell.value)).join('\t')).join('\r\n');
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64');
  const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const html=`<table data-aroundg-ledger="${encoded}">${payload.cells.map(row=>`<tr>${row.map(cell=>`<td>${escape(cell.value)}</td>`).join('')}</tr>`).join('')}</table>`;
  if(html.length>MAX_TEXT||text.length>MAX_TEXT)throw Error('CELL_RANGE_TOO_LARGE');
  return {text,html};
}
export function parseLedgerClipboard({text='',html=''}) {
  if(text.length>MAX_TEXT||html.length>MAX_TEXT)throw Error('CELL_RANGE_TOO_LARGE');
  const encoded=html.match(/data-aroundg-ledger="([A-Za-z0-9+/=]+)"/);
  if(encoded) {
    const payload=JSON.parse(Buffer.from(encoded[1],'base64').toString('utf8'));
    if(payload.schema!==LEDGER_COPY_SCHEMA)throw Error('CELL_CLIPBOARD_INVALID');
    return payload;
  }
  if(!text)throw Error('CELL_CLIPBOARD_EMPTY');
  const rows=[[]];let value='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(ch==='"'&&(quoted||value==='')) {
      if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;
    } else if(!quoted&&(ch==='\t'||ch==='\r'||ch==='\n')) {
      rows.at(-1).push({type:'text',value});value='';
      if(ch!=='\t'){if(ch==='\r'&&text[i+1]==='\n')i++;rows.push([]);}
    } else value+=ch;
  }
  rows.at(-1).push({type:'text',value});
  if(/[\r\n]$/.test(text)&&rows.at(-1).length===1&&rows.at(-1)[0].value==='')rows.pop();
  const width=Math.max(...rows.map(row=>row.length));
  if(rows.length*width>5000)throw Error('CELL_RANGE_TOO_LARGE');
  for(const row of rows)while(row.length<width)row.push({type:'text',value:''});
  return {schema:LEDGER_COPY_SCHEMA,cells:rows};
}
