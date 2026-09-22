import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {DOMParser} from '@xmldom/xmldom';
import {LEDGER_SPREADSHEET_ID,saveLedgerWorkbook} from '../services/ledger-workbook.mjs';
import {createLocalLedger} from '../services/local-ledger.mjs';
import {calculateLedger,shiftLedgerFormula} from '../services/ledger-calculation.mjs';
import {readLedgerImages} from '../services/ledger-xlsx.mjs';

const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function fixture() {
 const raw=Array.from({length:5},()=>Array.from({length:22},()=>({type:'text',value:''})));
 const put=(r,c,type,value)=>{raw[r-1][c-1]={type,value:String(value)};};
 put(2,1,'text','브랜드');put(2,3,'text','품번');put(2,4,'text','모델명');put(2,14,'text','구매가');
 put(1,20,'formula','=SUM(T3:T5)');put(5,1,'text','TEST');put(5,3,'text','001-ABC');put(5,4,'text','상품');
 put(5,10,'number',100000);put(5,14,'number',50000);put(5,16,'formula','=IF(J5="","",IF(J5<150000,15000,J5*0.1))');
 put(5,17,'number',3000);put(5,18,'formula','=IF(J5="","",J5-N5-P5-Q5)');put(5,19,'formula','=(N5/1.1)*0.1');put(5,20,'formula','=R5+S5');
 const sheet={id:1,name:'1-구매완료',rowCount:1000,columnCount:22,hidden:false,frozenRows:2,displayValues:raw.map(row=>row.map(v=>v.type==='formula'?'':v.value)),formulas:raw.map(row=>row.map(v=>v.type==='formula'?v.value:'')),rawValues:raw,notes:raw.map(row=>row.map(()=>'')),numberFormats:raw.map(row=>row.map(()=> 'General')),validations:raw.map(row=>row.map(()=>null)),merges:[{row:0,column:0,rows:1,columns:2}]};
 sheet.numberFormats[4][12]='m/d';sheet.numberFormats[4][13]='#,##0';
 const hidden={id:2,name:'사이즈',hidden:true,rowCount:1000,columnCount:2,displayValues:[['ONE','100']],formulas:[['','']],rawValues:[[{type:'text',value:'ONE'},{type:'number',value:'100'}]]};
 const account={...structuredClone(hidden),id:3,name:'계정정보',hidden:false,displayValues:[['무신사','fixture-only']],rawValues:[[{type:'text',value:'무신사'},{type:'text',value:'fixture-only'}]]};
 const files={
  '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  'xl/workbook.xml':strToU8(`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="1-구매완료" sheetId="1" r:id="rId1"/><sheet name="사이즈" sheetId="2" state="hidden" r:id="rId2"/><sheet name="계정정보" sheetId="3" r:id="rId3"/></sheets><definedNames><definedName name="Existing">'사이즈'!$A$1:$B$1</definedName></definedNames></workbook>`),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+[1,2,3].map(n=>`<Relationship Id="rId${n}" Target="worksheets/sheet${n}.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>`).join('')+'</Relationships>'),
  'xl/styles.xml':strToU8('<styles>original styles</styles>'),
  'xl/media/image1.png':new Uint8Array([137,80,78,71]),
 };
 for(const [i,s] of [sheet,hidden,account].entries())files[`xl/worksheets/sheet${i+1}.xml`]=strToU8(`<worksheet xmlns="${ns}"><dimension ref="A1:V1000"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" state="frozen"/></sheetView></sheetViews><sheetData><row r="5" ht="44"><c r="N5" s="3"><v>50000</v></c></row></sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells><dataValidations count="0"/></worksheet>`);
 const bytes=Buffer.from(zipSync(files));
 return {schemaVersion:1,spreadsheetId:LEDGER_SPREADSHEET_ID,title:'검증 장부',revision:'source-revision',capturedAt:'2026-09-21T00:00:00Z',timeZone:'Asia/Seoul',sheets:[sheet,hidden,account],xlsxBase64:bytes.toString('base64'),xlsxSha256:createHash('sha256').update(bytes).digest('hex')};
}
async function setup(t,book=fixture()) {
 const dir=await mkdtemp(join(tmpdir(),'local-ledger-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const sourcePath=join(dir,'source'),path=join(dir,'local'),encrypt=v=>Buffer.from(v).map(b=>b^85),decrypt=b=>Buffer.from(b).map(v=>v^85).toString();
 await saveLedgerWorkbook(sourcePath,book,encrypt);
 const options={sourcePath,path,encrypt,decrypt};return {dir,book,options,ledger:createLocalLedger(options)};
}
const editN=(book,value)=>({sheetId:1,row:5,column:14,revision:book.revision,expected:book.sheets[0].rawValues[4][13],next:{type:'number',value:String(value)}});
const purchase={brand:'TEST',articleNumber:'NEW-001',modelName:'주문 검증 상품',krSize:'105',purchaseDate:'2026-09-17',purchasePrice:100001,quantity:3,imageUrl:'https://image.msscdn.net/test.jpg',purchaseUrl:'https://www.musinsa.com/products/123',orderNumber:'fixture-order',orderEvidence:{orderLineId:'fixture-line'}};

test('one-time encrypted migration preserves source and all tabs; restart never imports over local edits',async t=>{
 const {ledger,options,book,dir}=await setup(t);const source=await readFile(options.sourcePath);
 const migrated=await ledger.load();assert.equal(migrated.local.sourceXlsxSha256,book.xlsxSha256);assert.equal(migrated.sheets.length,3);assert.equal(migrated.sheets[1].hidden,true);
 await ledger.export(join(dir,'copy.xlsx'));assert.deepEqual(await readFile(join(dir,'copy.xlsx')),Buffer.from(book.xlsxBase64,'base64'));
 const next=await ledger.edit(editN(migrated,60000));assert.equal(next.sheets[0].rawValues[4][13].value,'60000');
 assert.deepEqual(await readFile(options.sourcePath),source);
 const reopened=await createLocalLedger(options).view();assert.equal(reopened.revision,next.revision);assert.equal(reopened.sheets[0].rawValues[4][13].value,'60000');assert.equal(reopened.xlsxBase64,undefined);
});

test('local cell edits recalculate dependencies and export formulas while preserving archive parts',async t=>{
 const {ledger,book,dir}=await setup(t);const current=await ledger.load();
 const next=await ledger.edit(editN(current,60000));
 assert.equal(next.sheets[0].calculatedValues[4][17].value,22000);assert.ok(Math.abs(next.sheets[0].calculatedValues[0][19].value-27454.545454545452)<1e-8);
 await ledger.export(join(dir,'edited.xlsx'));const files=unzipSync(await readFile(join(dir,'edited.xlsx'))),original=unzipSync(Buffer.from(book.xlsxBase64,'base64'));
 assert.deepEqual(files['xl/styles.xml'],original['xl/styles.xml']);assert.deepEqual(files['xl/media/image1.png'],original['xl/media/image1.png']);
 const doc=new DOMParser().parseFromString(strFromU8(files['xl/worksheets/sheet1.xml']),'application/xml');
 const cells=Array.from(doc.getElementsByTagName('c'));assert.equal(cells.find(c=>c.getAttribute('r')==='N5').getAttribute('s'),'3');
 assert.equal(cells.find(c=>c.getAttribute('r')==='N5').textContent,'60000');assert.equal(cells.find(c=>c.getAttribute('r')==='R5').getElementsByTagName('f')[0].textContent,'IF(J5="","",J5-N5-P5-Q5)');
 assert.match(strFromU8(files['xl/workbook.xml']),/state="hidden"/);assert.match(strFromU8(files['xl/workbook.xml']),/definedName name="Existing"/);assert.equal(doc.getElementsByTagName('mergeCell')[0].getAttribute('ref'),'A1:B1');
});

test('offline purchase appends individual units, images, notes and filled formulas; retry after restart is idempotent',async t=>{
 const {ledger,options,dir}=await setup(t);const originalFetch=global.fetch;global.fetch=()=>{throw Error('NETWORK_MUST_NOT_BE_USED');};t.after(()=>{global.fetch=originalFetch;});
 const result=await ledger.record(purchase);assert.deepEqual(result.rowNumbers,[6,7,8]);assert.deepEqual(result.unitPrices,[33334,33334,33333]);
 const loaded=await ledger.load();assert.equal(loaded.sheets[0].formulas[5][17],'=IF(J6="","",J6-N6-P6-Q6)');assert.match(loaded.sheets[0].formulas[5][7],/^=IMAGE/);
 assert.equal(loaded.sheets[0].formulas[0][19],'=SUM(T3:T8)');
 const again=await createLocalLedger(options).record(purchase);assert.equal(again.duplicate,true);assert.deepEqual(again.rowNumbers,result.rowNumbers);
 await assert.rejects(ledger.record({...purchase,purchasePrice:100002}),/PURCHASE_EXISTING_CONFLICT/);
 await ledger.export(join(dir,'orders.xlsx'));const parts=unzipSync(await readFile(join(dir,'orders.xlsx')));
 assert.match(strFromU8(parts['xl/comments/aroundg-1.xml']),/around-g.purchase.units.v1/);assert.match(strFromU8(parts['xl/worksheets/sheet1.xml']),/IMAGE/);
 const final=await ledger.view();assert.equal(final.sheets[0].rawValues.filter(r=>r[2]?.value==='NEW-001').length,3);
});

test('migrated purchase receipt is recognized without appending duplicate rows',async t=>{
 const book=fixture();book.sheets[0].notes[4][7]=JSON.stringify({schema:'around-g.purchase.units.v1',key:JSON.stringify([purchase.orderNumber,purchase.orderEvidence.orderLineId]),quantity:1,unit:1,total:50000});
 const {ledger}=await setup(t,book);const result=await ledger.record({...purchase,quantity:1,purchasePrice:50000});assert.equal(result.duplicate,true);assert.deepEqual(result.rowNumbers,[5]);
});

test('stale concurrent edits, invalid dates/numbers, merged cells and dropdowns do not overwrite data',async t=>{
 const book=fixture();book.sheets[0].validations[4][11]={type:'list',values:['구매완료','반품완료']};const {ledger}=await setup(t,book),current=await ledger.load();
 for(const value of ['62,330원','1e9','9007199254740993'])await assert.rejects(ledger.edit(editN(current,value)),/CELL_NUMBER_INVALID/);
 await assert.rejects(ledger.edit({...editN(current,1),next:{type:'date',value:'2026-02-30'}}),/CELL_DATE_INVALID/);
 await assert.rejects(ledger.edit({...editN(current,1),row:1,column:2,expected:{type:'text',value:''}}),/CELL_MERGED/);
 await assert.rejects(ledger.edit({...editN(current,1),column:12,expected:{type:'text',value:''},next:{type:'text',value:'잘못된 상태'}}),/CELL_VALIDATION_FAILED/);
 const results=await Promise.allSettled([ledger.edit(editN(current,60000)),ledger.edit(editN(current,70000))]);assert.equal(results[0].status,'fulfilled');assert.match(results[1].reason.message,/CELL_CONFLICT/);
 assert.equal((await ledger.load()).sheets[0].rawValues[4][13].value,'60000');
});

test('failed durable save never publishes changed money or a successful purchase',async t=>{
 const {ledger,options}=await setup(t);const current=await ledger.load();
 const failing=createLocalLedger({...options,save:async()=>{throw Error('DISK_FULL');}});
 await assert.rejects(failing.edit(editN(current,60000)),/DISK_FULL/);await assert.rejects(failing.record(purchase),/DISK_FULL/);
 assert.equal((await ledger.load()).revision,current.revision);assert.equal((await ledger.load()).sheets[0].rawValues.length,5);
});

test('embedded product pictures are available offline and a photo-cell edit removes only its old drawing',async t=>{
 const book=fixture(),files=unzipSync(Buffer.from(book.xlsxBase64,'base64'));
 files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace('</worksheet>','<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="picture"/></worksheet>'));
 files['xl/worksheets/_rels/sheet1.xml.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Target="../drawings/drawing1.xml"/></Relationships>');
 files['xl/drawings/drawing1.xml']=strToU8('<x:wsDr xmlns:x="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:twoCellAnchor><x:from><x:col>7</x:col><x:row>4</x:row></x:from><x:pic><a:blip r:embed="photo"/></x:pic></x:twoCellAnchor></x:wsDr>');
 files['xl/drawings/_rels/drawing1.xml.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="photo" Target="/xl/media/image1.png"/></Relationships>');
 const bytes=Buffer.from(zipSync(files));book.xlsxBase64=bytes.toString('base64');book.xlsxSha256=createHash('sha256').update(bytes).digest('hex');
 readLedgerImages(book);assert.deepEqual(book.sheets[0].images,[{row:5,column:8,url:'data:image/png;base64,iVBORw=='}]);
 const {ledger,dir}=await setup(t,book),migrated=await ledger.load();
 const next=await ledger.edit({...editN(migrated,1),column:8,expected:{type:'text',value:''},next:{type:'formula',value:'=IMAGE("https://image.msscdn.net/new.jpg",1)'}});
 assert.equal(next.sheets[0].images.length,0);await ledger.export(join(dir,'photo.xlsx'));
 const updated=unzipSync(await readFile(join(dir,'photo.xlsx')));assert.doesNotMatch(strFromU8(updated['xl/drawings/drawing1.xml']),/twoCellAnchor/);assert.deepEqual(updated['xl/media/image1.png'],files['xl/media/image1.png']);
});

test('formula calculation respects blank fees, lookup sheets, error propagation and relative fill',()=>{
 const book=fixture(),s=book.sheets[0];s.formulas[2][0]='=VLOOKUP("ONE",\'사이즈\'!A1:B1,2,FALSE)';s.formulas[2][1]='=IF(J3="","",J3/2)';s.formulas[2][2]='=1+" "';s.formulas[2][3]='=SUM(C3:C4)';s.formulas[2][4]='=IFERROR(D3,"")';
 calculateLedger(book);assert.equal(s.calculatedValues[2][0].value,100);assert.equal(s.calculatedValues[2][1].value,'');assert.equal(s.calculatedValues[2][2].value,'#VALUE!');assert.equal(s.calculatedValues[2][3].value,'#VALUE!');assert.equal(s.calculatedValues[2][4].value,'');
 s.formulas[2][5]='=COUNTA(A3:B4)';s.formulas[2][6]='=SUM("2",TRUE,3)';s.formulas[2][7]='=AVERAGE(C3:C4)';calculateLedger(book);
 assert.equal(s.calculatedValues[2][5].value,2);assert.equal(s.calculatedValues[2][6].value,6);assert.equal(s.calculatedValues[2][7].value,'#VALUE!');
 assert.equal(shiftLedgerFormula('=IF(A5="A5",\'시트5\'!$B$3+$C5,"https://example.test/A5")',2),'=IF(A7="A5",\'시트5\'!$B$3+$C7,"https://example.test/A5")');
});
