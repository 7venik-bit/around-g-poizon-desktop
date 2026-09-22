import test from 'node:test';
import assert from 'node:assert/strict';
import {autofillLedger,ledgerRowFormulas} from '../services/ledger-autofill.mjs';
import {calculateLedger} from '../services/ledger-calculation.mjs';
import {ledgerCategoryIndex} from '../services/ledger-categories.mjs';

function fixture() {
  const headers=['브랜드','구매링크','품번','모델명','성별','EU 사이즈','한국 사이즈','사진','판매량','판매가\n(원화)','판매 일자','상태','구매 일자','구매가','카드','예상\n수수료','택배비','간이마진','부가세환급','일반마진','구매가비 마진율','판매가비 마진율'];
  const s={id:1,name:'1-구매완료',rowCount:1000,columnCount:30,rawValues:[],formulas:[],displayValues:[],numberFormats:[]};
  for(let r=0;r<45;r++){s.rawValues[r]=Array.from({length:30},()=>({type:'text',value:''}));s.formulas[r]=Array(30).fill('');s.displayValues[r]=Array(30).fill('');}
  const put=(r,c,value)=>{const type=typeof value==='number'?'number':String(value).startsWith('=')?'formula':'text';s.rawValues[r-1][c-1]={type,value:String(value)};s.formulas[r-1][c-1]=type==='formula'?value:'';s.displayValues[r-1][c-1]=type==='formula'?'':String(value);};
  headers.forEach((h,i)=>put(2,i+1,h));
  return {book:{sheets:[s]},s,put};
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('repairs sale-date, previous-row and distant-row references; blanks and numeric money text calculate correctly',()=>{
  const {book,s,put}=fixture();
  for(const r of [36,37,38,39,40,41]) {
    put(r,3,`MODEL-${r}`);put(r,10,r===38?'75000':100000);put(r,11,'9/16');put(r,14,50000);put(r,17,3490);
    put(r,16,`=if(K${r}="","",if(K${r}<150000,15000,K${r}*0.1))`);
    put(r,18,`=if(K${r}="","",K${r}-N${r}-P${r}-Q${r})`);
    put(r,19,`=(N${r}/1.1)*0.1`);put(r,20,`=R${r-1}+S${r}`);put(r,21,`=T${r}/N${r}`);put(r,22,`=if(K${r}="","",T${r}/K${r})`);
  }
  put(39,11,' ');put(41,18,'=IF(J574="","",J574-N574-P574-Q574)');put(41,19,'=IF(N574="","",(N574/1.1)*0.1)');
  put(41,20,'=IF(R574="","",R574+S574)');put(41,21,'=IFERROR(T574/N574,"")');put(41,22,'=IF(J574="","",T574/J574)');
  const repaired=autofillLedger(book,{repair:true});calculateLedger(book);
  assert.ok(repaired.edits.length>30);assert.equal(book.calculation.errorCount,0);
  for(const r of [36,37,38,39,40,41]){const margin=(r===38?75000:100000)-50000-15000-3490;close(s.calculatedValues[r-1][17].value,margin);close(s.calculatedValues[r-1][19].value,margin+50000/11);}
  assert.equal(s.rawValues[37][9].value,'75000');assert.equal(s.rawValues[38][10].value,' ');
  assert.equal(autofillLedger(book,{repair:true}).edits.length,0);
});

test('new product rows get formulas; empty rows are not populated and user clear/custom formulas remain intentional',()=>{
  const {book,s,put}=fixture();put(42,3,'NEW');put(42,14,84130);put(42,17,3490);
  autofillLedger(book,{edits:[{sheetId:1,row:42,column:3}]});calculateLedger(book);
  assert.equal(s.formulas[41][17],ledgerRowFormulas(42)[18]);assert.equal(s.calculatedValues[41][17].value,'');
  assert.equal(s.formulas[42][17],'');
  put(42,10,75000);autofillLedger(book,{edits:[{sheetId:1,row:42,column:10}]});calculateLedger(book);
  assert.equal(s.calculatedValues[41][17].value,-27620);
  put(42,19,'=N42*0.08');put(42,20,'');autofillLedger(book,{edits:[{sheetId:1,row:42,column:19},{sheetId:1,row:42,column:20}]});
  put(42,14,80000);autofillLedger(book,{edits:[{sheetId:1,row:42,column:14}]});
  assert.equal(s.formulas[41][18],'=N42*0.08');assert.equal(s.formulas[41][19],'');
});

test('missing inputs are not zero, invalid money remains visible, and zero denominators stay undefined',()=>{
  const {book,s,put}=fixture();put(5,3,'ITEM');put(5,10,' ');put(5,14,50000);put(5,17,3490);autofillLedger(book,{repair:true});calculateLedger(book);
  assert.equal(s.calculatedValues[4][15].value,'');assert.equal(s.calculatedValues[4][19].value,'');
  put(5,10,'잘못된 금액');calculateLedger(book);assert.equal(s.calculatedValues[4][15].value,'#VALUE!');
  put(5,10,0);put(5,14,0);calculateLedger(book);assert.equal(s.calculatedValues[4][20].value,'');assert.equal(s.calculatedValues[4][21].value,'');
});

test('repair preserves manual fees/shipping/custom formulas and unrelated worksheets',()=>{
  const {book,s,put}=fixture();put(5,3,'ITEM');put(5,16,19040);put(5,17,'=4000/8');put(5,19,'=N5*0.08');
  const other=structuredClone(s);other.id=2;other.rawValues[1][9].value='다른 표';book.sheets.push(other);const before=structuredClone(other);
  autofillLedger(book,{repair:true});assert.equal(s.rawValues[4][15].value,'19040');assert.equal(s.formulas[4][16],'=4000/8');assert.equal(s.formulas[4][18],'=N5*0.08');assert.deepEqual(other,before);
});

test('category lookup requires agreeing exact article matches, exposes conflicts and preserves manual categories',()=>{
  const {book,s,put}=fixture();put(5,3,'AB-123-服');put(6,3,'XY999');
  const categories=[{articleNumber:'AB123',categoryName:'의류 / 상의',source:'local.xlsx'},{articleNumber:'AB-123',categoryName:'의류 / 상의',source:'local2.xlsx'},{articleNumber:'XY999',categoryName:'가방'},{articleNumber:'XY999',categoryName:'신발'}];
  const lookup=ledgerCategoryIndex(categories);assert.equal(lookup('AB1234').status,'missing');assert.equal(lookup('XY999').status,'conflict');
  autofillLedger(book,{repair:true,categories});assert.equal(s.rawValues[1][22].value,'카테고리');assert.equal(s.rawValues[4][22].value,'의류 / 상의');assert.equal(s.rawValues[5][22].value,'');
  assert.equal(book.local.categories[1].rows[6].status,'conflict');
  autofillLedger(book,{edits:[{sheetId:1,row:5,column:10}],categories:[]});assert.equal(s.rawValues[4][22].value,'의류 / 상의');
  put(5,23,'의류 / 아우터');autofillLedger(book,{edits:[{sheetId:1,row:5,column:23}],categories});
  autofillLedger(book,{edits:[{sheetId:1,row:5,column:10}],categories});assert.equal(s.rawValues[4][22].value,'의류 / 아우터');
});

test('category column never overwrites a used trailing column and does not invent categories from product titles',()=>{
  const {book,s,put}=fixture();put(2,23,'사용자 메모');put(5,23,'유지');put(5,3,'UNKNOWN');put(5,4,'여성 가방');
  autofillLedger(book,{repair:true,categories:[]});assert.equal(s.rawValues[4][22].value,'유지');assert.equal(book.local.categories[1].column,24);assert.equal(s.rawValues[4][23].value,'');
});

test('summary totals include repaired numeric text and future data rows without summing stale cached errors',()=>{
  const {book,s,put}=fixture();put(5,3,'ITEM');put(5,10,'75000');put(5,14,50000);put(5,17,3490);
  put(1,10,' ');put(1,14,' ');put(1,19,'=SUM(S5:S40)');put(1,20,'=SUM(T5:T40)');put(1,21,'=T1/N1');put(1,22,'=T1/J1');
  autofillLedger(book,{repair:true});calculateLedger(book);
  assert.equal(s.rawValues[4][9].type,'number');assert.equal(s.calculatedValues[0][9].value,75000);assert.equal(s.calculatedValues[0][13].value,50000);assert.equal(book.calculation.errorCount,0);
  put(42,3,'NEXT');put(42,10,100000);put(42,14,60000);put(42,17,3000);autofillLedger(book,{edits:[{sheetId:1,row:42,column:3}]});calculateLedger(book);
  assert.equal(s.calculatedValues[0][9].value,175000);close(s.calculatedValues[0][20].value,s.calculatedValues[0][19].value/110000);
});
