import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {DOMParser} from '@xmldom/xmldom';
import {LEDGER_SPREADSHEET_ID,saveLedgerWorkbook,readLedgerWorkbook} from '../services/ledger-workbook.mjs';
import {createLocalLedger} from '../services/local-ledger.mjs';
import {calculateLedger,shiftLedgerFormula} from '../services/ledger-calculation.mjs';
import {readLedgerImages} from '../services/ledger-xlsx.mjs';
import {ledgerClipboardData,parseLedgerClipboard,LEDGER_COPY_SCHEMA} from '../services/ledger-clipboard.mjs';
import {autofillLedger} from '../services/ledger-autofill.mjs';

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
  'xl/styles.xml':strToU8(`<styleSheet xmlns="${ns}"><fonts count="1"><font><sz val="11"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4">${[0,44,14,3].map(numFmtId=>`<xf numFmtId="${numFmtId}" fontId="0" fillId="0" borderId="0" xfId="0"><alignment horizontal="center"/></xf>`).join('')}</cellXfs></styleSheet>`),
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

test('successful seller order fills freight and recalculates margins in both local tabs after reopening',async t=>{
 const original=calculationFixture(),source=original.sheets[0],sales=structuredClone(source);
 sales.id=4;sales.name='5-판매완료';sales.rawValues=source.rawValues.map(row=>row.map(()=>({type:'text',value:''})));
 sales.displayValues=sales.rawValues.map(row=>row.map(()=>''));sales.formulas=sales.rawValues.map(row=>row.map(()=>''));
 sales.rawValues[1]=structuredClone(source.rawValues[1]);sales.displayValues[1]=structuredClone(source.displayValues[1]);
 sales.notes=sales.rawValues.map(row=>row.map(()=>''));sales.images=[];
 original.sheets.push(sales);
 const files=unzipSync(Buffer.from(original.xlsxBase64,'base64'));
 files['xl/workbook.xml']=strToU8(strFromU8(files['xl/workbook.xml']).replace('</sheets>','<sheet name="5-판매완료" sheetId="4" r:id="rId4"/></sheets>'));
 files['xl/_rels/workbook.xml.rels']=strToU8(strFromU8(files['xl/_rels/workbook.xml.rels']).replace('</Relationships>','<Relationship Id="rId4" Target="worksheets/sheet4.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>'));
 files['xl/worksheets/sheet4.xml']=strToU8(`<worksheet xmlns="${ns}"><dimension ref="A1:V1000"/><sheetData/></worksheet>`);
 const bytes=Buffer.from(zipSync(files));original.xlsxBase64=bytes.toString('base64');original.xlsxSha256=createHash('sha256').update(bytes).digest('hex');
 const {ledger,options,dir}=await setup(t,original),order={orderNumber:'21315202429263299',status:'거래 성공',route:'일반판매',quantity:1,articleNumber:'001-ABC',size:'105',imageUrl:'https://example.com/product.png',buyerPaidAt:'2026-09-16 18:00:00',orderClosedAt:'2026-09-16 18:06:50',saleDate:'2026-09-16',salePrice:100000,basicFee:15000,freightFee:3000,income:82000};
 const first=await ledger.syncPoizonSales([order]);assert.equal(first.recorded.length,1);assert.equal(first.verified,1);
 const reopened=createLocalLedger(options),second=await reopened.syncPoizonSales([order]);assert.equal(second.updated,false);
 const book=await reopened.load(),record=first.recorded[0];
 assert.equal(book.sheets[0].rawValues[4][10].type,'date');assert.equal(book.sheets[0].rawValues[4][15].value,'15000');
 assert.equal(book.sheets[0].rawValues[4][16].value,'3000');
 assert.equal(book.sheets[3].rawValues[record.salesRow-1][9].value,'100000');
 assert.equal(book.sheets[3].rawValues[record.salesRow-1][16].value,'3000');
 for(const sheet of [book.sheets[0],book.sheets[3]]) {
   const row=sheet===book.sheets[0]?5:record.salesRow;
   for(const column of [18,19,20,21,22])assert.equal(sheet.rawValues[row-1][column-1].type,'formula');
   assert.equal(sheet.calculatedValues[row-1][17].value,32000);
   assert.ok(Number(sheet.calculatedValues[row-1][19].value)>32000);
   assert.match(sheet.displayValues[row-1][17],/₩/);
   assert.match(sheet.displayValues[row-1][20],/%$/);
 }
 await reopened.export(join(dir,'poizon.xlsx'));const exported=unzipSync(await readFile(join(dir,'poizon.xlsx')));
 assert.match(strFromU8(exported['xl/worksheets/sheet4.xml']),new RegExp(`r="J${record.salesRow}"`));
 const styles=strFromU8(exported['xl/styles.xml']);
 assert.match(styles,/numFmtId="10"[^>]*applyNumberFormat="1"/);
 assert.match(styles,/formatCode="&quot;₩&quot;#,##0"/);
 assert.match(strFromU8(exported['xl/worksheets/sheet4.xml']),new RegExp(`<c r="U${record.salesRow}" s="\\d+"`));
 const stale=await readLedgerWorkbook(options.path,options.decrypt);
 for(const [sheet,row] of [[stale.sheets[0],5],[stale.sheets[3],record.salesRow]])
   for(const column of [17,18,19,20,21,22])sheet.numberFormats[row-1][column-1]='General';
 for(const [sheet,row] of [[stale.sheets[0],5],[stale.sheets[3],record.salesRow]])
   for(const column of [19,20])sheet.numberFormats[row-1][column-1]='"₩"#,##0.00';
 for(const sheet of [stale.sheets[0],stale.sheets[3]]) {
   sheet.rawValues[3][2]={type:'text',value:'MANUAL-ROW'};
   for(const [column,value] of [[19,'1234.56'],[20,'6789.44'],[21,'0.123456'],[22,'0.234567']])
     sheet.rawValues[3][column-1]={type:'number',value};
 }
 stale.local.poizonOrders={}; // Old snapshots may retain the order note but lose the row index.
 await saveLedgerWorkbook(options.path,stale,options.encrypt);
 const repaired=await createLocalLedger(options).load();
 for(const [sheet,row] of [[repaired.sheets[0],5],[repaired.sheets[3],record.salesRow]]) {
   assert.equal(sheet.numberFormats[row-1][20],'0.00%');
   assert.equal(sheet.numberFormats[row-1][18],'"₩"#,##0');
   assert.equal(sheet.numberFormats[row-1][19],'"₩"#,##0');
   assert.match(sheet.displayValues[row-1][20],/%$/);
   assert.match(sheet.displayValues[row-1][17],/₩/);
   assert.doesNotMatch(sheet.displayValues[row-1][18],/\.\d/);
 }
 for(const sheet of [repaired.sheets[0],repaired.sheets[3]]) {
   assert.equal(sheet.displayValues[3][18],'₩1,235');
   assert.equal(sheet.displayValues[3][19],'₩6,789');
   assert.equal(sheet.displayValues[3][20],'12.35%');
   assert.equal(sheet.displayValues[3][21],'23.46%');
 }
 assert.ok(repaired.local.poizonFormatRepair);
 const backup=await readLedgerWorkbook(repaired.local.poizonFormatRepair.backupPath,options.decrypt);
 assert.equal(backup.sheets[0].numberFormats[4][20],'General');
});

function calculationFixture() {
 const book=fixture(),s=book.sheets[0];
 const headers=['브랜드','구매링크','품번','모델명','성별','EU 사이즈','한국 사이즈','사진','판매량','판매가 (원화)','판매 일자','상태','구매 일자','구매가','카드','예상 수수료','택배비','간이마진','부가세환급','일반마진','구매가비 마진율','판매가비 마진율'];
 headers.forEach((value,c)=>{s.rawValues[1][c]={type:'text',value};s.displayValues[1][c]=value;});
 s.formulas[4][17]='=IF(K574="","",K574-N574-P574-Q574)';s.rawValues[4][17]={type:'formula',value:s.formulas[4][17]};
 return book;
}

test('template repair backs up the encrypted workbook, persists formulas/categories and exports calculated caches without touching pictures',async t=>{
 const {ledger:unused,options,dir,book}=await setup(t,calculationFixture());
 const ledger=createLocalLedger({...options,categories:async()=>[{articleNumber:'001-ABC',categoryName:'의류 / 상의',source:'saved.xlsx'}]});
 const repaired=await ledger.load();assert.equal(repaired.local.formulaVersion,3);assert.equal(repaired.sheets[0].calculatedValues[4][17].value,32000);
 const backup=await readLedgerWorkbook(repaired.local.formulaRepair.backupPath,options.decrypt);assert.equal(backup.sheets[0].formulas[4][17],'=IF(K574="","",K574-N574-P574-Q574)');
 assert.equal(repaired.sheets[0].rawValues[4][22].value,'의류 / 상의');assert.ok(repaired.local.formulaRepair.changes.length>0);
 const again=await createLocalLedger(options).view();assert.equal(again.revision,repaired.revision);
 await ledger.export(join(dir,'repaired.xlsx'));const files=unzipSync(await readFile(join(dir,'repaired.xlsx'))),original=unzipSync(Buffer.from(book.xlsxBase64,'base64'));
 const doc=new DOMParser().parseFromString(strFromU8(files['xl/worksheets/sheet1.xml']),'application/xml'),cells=Array.from(doc.getElementsByTagName('c'));
 assert.equal(cells.find(c=>c.getAttribute('r')==='R5').getElementsByTagName('v')[0].textContent,'32000');assert.equal(cells.find(c=>c.getAttribute('r')==='W5').textContent,'의류 / 상의');
 assert.deepEqual(files['xl/styles.xml'],original['xl/styles.xml']);assert.deepEqual(files['xl/media/image1.png'],original['xl/media/image1.png']);
});

test('backup failure prevents any automatic repair from replacing the working workbook',async t=>{
 const {options}=await setup(t,calculationFixture());
 let writes=[];const ledger=createLocalLedger({...options,save:async(path,...args)=>{writes.push(path);if(path.includes('before-formulas'))throw Error('BACKUP_DISK_FULL');return saveLedgerWorkbook(path,...args);}});
 await assert.rejects(ledger.load(),/BACKUP_DISK_FULL/);
 const saved=await readLedgerWorkbook(options.path,options.decrypt);assert.equal(saved.local.formulaVersion,undefined);assert.match(saved.sheets[0].formulas[4][17],/574/);assert.equal(writes.filter(p=>p===options.path).length,1);
});

test('version-1 ledger upgrades fee policy with a separate backup, updates on category edits and exports live formulas',async t=>{
 const original=calculationFixture(),s=original.sheets[0];
 autofillLedger(original,{repair:true,categories:[{articleNumber:'001-ABC',categoryName:'가방 / 숄더백'}]});
 original.local.formulaVersion=1;delete original.local.fees;
 s.rawValues[4][9]={type:'number',value:'126000'};s.rawValues[4][15]={type:'number',value:'17640'};s.formulas[4][15]='';
 const {options,dir}=await setup(t,original);
 await saveLedgerWorkbook(options.path,original,options.encrypt);
 const oldBackup=options.path+'.before-formulas-v1.encrypted';await saveLedgerWorkbook(oldBackup,original,options.encrypt);const oldBytes=await readFile(oldBackup);
 const ledger=createLocalLedger(options),upgraded=await ledger.load();
 assert.equal(upgraded.local.formulaVersion,3);assert.equal(upgraded.sheets[0].calculatedValues[4][15].value,18000);
 assert.match(upgraded.local.formulaRepair.backupPath,/before-formulas-v3/);
 assert.equal((await readLedgerWorkbook(upgraded.local.formulaRepair.backupPath,options.decrypt)).sheets[0].rawValues[4][15].value,'17640');
 assert.deepEqual(await readFile(oldBackup),oldBytes);
 const changed=await ledger.edit({sheetId:1,row:5,column:23,revision:upgraded.revision,expected:upgraded.sheets[0].rawValues[4][22],next:{type:'text',value:'의류'}});
 assert.equal(changed.sheets[0].calculatedValues[4][15].value,15000);
 const capped=await ledger.edit({sheetId:1,row:5,column:10,revision:changed.revision,expected:changed.sheets[0].rawValues[4][9],next:{type:'number',value:'1000000'}});
 assert.equal(capped.sheets[0].calculatedValues[4][15].value,45000);
 const reopened=await createLocalLedger(options).load();assert.equal(reopened.revision,capped.revision);
 await ledger.export(join(dir,'fees.xlsx'));const files=unzipSync(await readFile(join(dir,'fees.xlsx')));
 const doc=new DOMParser().parseFromString(strFromU8(files['xl/worksheets/sheet1.xml']),'application/xml');
 const p=Array.from(doc.getElementsByTagName('c')).find(c=>c.getAttribute('r')==='P5');
 assert.equal(p.getElementsByTagName('v')[0].textContent,'45000');assert.match(p.getElementsByTagName('f')[0].textContent,/W5/);
 assert.deepEqual(files['xl/styles.xml'],unzipSync(Buffer.from(original.xlsxBase64,'base64'))['xl/styles.xml']);
});

test('version-2 local ledger repairs a missing middle calculation without replacing manual values',async t=>{
 const original=calculationFixture(),s=original.sheets[0];
 original.local={formulaVersion:2,formulaOverrides:{1:{'5:16':true}}};
 s.rawValues[4][17]={type:'text',value:''};s.formulas[4][17]='';s.displayValues[4][17]='';
 s.rawValues[4][15]={type:'number',value:'18000'};s.formulas[4][15]='';s.displayValues[4][15]='18000';
 const {options}=await setup(t,original);await saveLedgerWorkbook(options.path,original,options.encrypt);
 const ledger=createLocalLedger(options),repaired=await ledger.load();
 assert.equal(repaired.local.formulaVersion,3);
 assert.equal(repaired.sheets[0].rawValues[4][15].value,'18000');
 assert.match(repaired.sheets[0].formulas[4][17],/J5/);
 assert.equal(repaired.sheets[0].calculatedValues[4][17].value,29000);
 assert.match(repaired.local.formulaRepair.backupPath,/before-formulas-v3/);
});

test('explicit clearing of an automatic formula survives restart and subsequent input edits',async t=>{
 const {ledger,options}=await setup(t,calculationFixture()),current=await ledger.load();
 const cleared=await ledger.change({action:'clear',sheetId:1,revision:current.revision,range:{row:5,column:18}});
 const reopened=createLocalLedger(options);const next=await reopened.edit(editN(cleared,60000));assert.equal(next.sheets[0].formulas[4][17],'');assert.equal(next.sheets[0].calculatedValues[4][19].value,'');
});

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

test('selected purchase row fills units at 42 instead of after 575, preserves defaults/formulas and exports the same cells',async t=>{
 const book=fixture(),s=book.sheets[0];
 while(s.rawValues.length<575){s.rawValues.push(Array.from({length:22},()=>({type:'text',value:''})));s.formulas.push(Array(22).fill(''));s.displayValues.push(Array(22).fill(''));}
 s.rawValues[574][2]={type:'text',value:'EXISTING-575'};s.formulas[0][19]='=SUM(T3:T575)';s.rawValues[0][19]={type:'formula',value:s.formulas[0][19]};
 for(let r=41;r<=43;r++){s.rawValues[r][4]={type:'text',value:'공용'};s.rawValues[r][11]={type:'text',value:'구매완료'};s.rawValues[r][16]={type:'number',value:'4890'};}
 s.formulas[41][18]='=N42*0.08';s.rawValues[41][18]={type:'formula',value:s.formulas[41][18]};
 const {ledger,dir,options}=await setup(t,book),current=await ledger.load(),destination={sheetId:1,row:42,revision:current.revision};
 const result=await ledger.record(purchase,destination);assert.deepEqual(result.rowNumbers,[42,43,44]);assert.deepEqual(result.unitPrices,[33334,33334,33333]);
 const saved=await ledger.load(),sheet=saved.sheets[0];
 assert.equal(sheet.rawValues[574][2].value,'EXISTING-575');assert.equal(sheet.rawValues[41][4].value,'공용');assert.equal(sheet.rawValues[41][16].value,'4890');
 assert.equal(sheet.formulas[0][19],'=SUM(T3:T575)');assert.equal(sheet.formulas[41][18],'=N42*0.08');assert.equal(sheet.formulas[41][17],'=IF(J42="","",J42-N42-P42-Q42)');
 assert.match(sheet.formulas[41][7],/^=IMAGE/);assert.equal(sheet.rawValues.filter(r=>r[2]?.value==='NEW-001').length,3);
 const duplicate=await createLocalLedger(options).record(purchase,{...destination,revision:saved.revision});assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.rowNumbers,[42,43,44]);
 await ledger.export(join(dir,'selected.xlsx'));const files=unzipSync(await readFile(join(dir,'selected.xlsx'))),doc=new DOMParser().parseFromString(strFromU8(files['xl/worksheets/sheet1.xml']),'application/xml'),cells=Array.from(doc.getElementsByTagName('c'));
 assert.match(cells.find(c=>c.getAttribute('r')==='H42').textContent,/IMAGE/);assert.match(cells.find(c=>c.getAttribute('r')==='C42').textContent,/NEW-001/);assert.match(strFromU8(files['xl/comments/aroundg-1.xml']),/ref="H42"/);
});

test('re-recording the receipt at 42 relocates 575-577, preserving prices, photos, formulas and a verified backup',async t=>{
 const {options,dir}=await setup(t,calculationFixture()),row={...purchase,purchasePrice:163460};
 const ledger=createLocalLedger({...options,categories:async()=>[{articleNumber:'NEW-001',categoryName:'의류'}]});
 let current=await ledger.load();
 await ledger.record(row,{sheetId:1,row:575,revision:current.revision});current=await ledger.load();
 current=await ledger.edit({sheetId:1,row:575,column:10,revision:current.revision,expected:current.sheets[0].rawValues[574][9],next:{type:'number',value:'75000'}});
 current=await ledger.change({action:'clear',sheetId:1,revision:current.revision,range:{row:575,column:18}});
 const before=await ledger.load(),partsBefore=unzipSync(Buffer.from(before.xlsxBase64,'base64'));
 const result=await ledger.record(row,{sheetId:1,row:42,revision:before.revision});
 assert.equal(result.moved,true);assert.deepEqual(result.previousRowNumbers,[575,576,577]);assert.deepEqual(result.rowNumbers,[42,43,44]);assert.deepEqual(result.unitPrices,[54487,54487,54486]);
 const saved=await createLocalLedger(options).load(),s=saved.sheets[0];
 assert.equal(s.rawValues.filter(r=>r[2]?.value==='NEW-001').length,3);assert.equal(s.rawValues[41][9].value,'75000');
 assert.equal(s.formulas[41][17],'');assert.equal(saved.local.formulaOverrides[1]['42:18'],true);assert.equal(saved.local.formulaOverrides[1]['575:18'],undefined);
 assert.equal(saved.local.categories[1].rows[575],undefined);assert.ok(saved.local.categories[1].rows[42]);
 for(let r=41;r<44;r++){assert.match(s.formulas[r][7],/^=IMAGE/);assert.match(s.formulas[r][18],new RegExp(`N${r+1}`));assert.equal(JSON.parse(s.notes[r][7]).unit,r-40);}
 for(let r=574;r<577;r++){assert.ok(s.rawValues[r].every(v=>v.value===''));assert.ok(s.notes[r].every(v=>v===''));}
 const backup=await readLedgerWorkbook(saved.local.receiptMoves[0].backupPath,options.decrypt);assert.equal(backup.revision,before.revision);assert.equal(backup.sheets[0].rawValues[574][2].value,'NEW-001');
 const duplicate=await ledger.record(row,{sheetId:1,row:42,revision:saved.revision});assert.equal(duplicate.duplicate,true);assert.equal((await ledger.load()).revision,saved.revision);
 await ledger.export(join(dir,'moved.xlsx'));const parts=unzipSync(await readFile(join(dir,'moved.xlsx'))),comments=strFromU8(parts['xl/comments/aroundg-1.xml']);
 assert.doesNotMatch(comments,/ref="H57[567]"/);for(const n of [42,43,44])assert.match(comments,new RegExp(`ref="H${n}"`));
 const oldStyles=new DOMParser().parseFromString(strFromU8(partsBefore['xl/styles.xml']),'application/xml'),newStyles=new DOMParser().parseFromString(strFromU8(parts['xl/styles.xml']),'application/xml');
 const oldXfs=oldStyles.getElementsByTagName('cellXfs')[0].childNodes,newXfs=newStyles.getElementsByTagName('cellXfs')[0].childNodes;
 for(let i=0;i<oldXfs.length;i++)assert.equal(newXfs[i].toString(),oldXfs[i].toString());
 assert.deepEqual(parts['xl/worksheets/sheet2.xml'],partsBefore['xl/worksheets/sheet2.xml']);
});

test('overlapping receipt moves keep each unit once and move embedded photos and notes',async t=>{
 const {ledger}=await setup(t),first=await ledger.load();await ledger.record(purchase,{sheetId:1,row:42,revision:first.revision});let current=await ledger.load();
 current=await ledger.change({action:'paste',sheetId:1,revision:current.revision,range:{row:42,column:8},payload:{schema:LEDGER_COPY_SCHEMA,cells:[[{type:'text',value:''}]],images:[{row:0,column:0,url:'data:image/png;base64,iVBORw=='}]}});
 await ledger.record(purchase,{sheetId:1,row:43,revision:current.revision});const moved=await ledger.load();readLedgerImages(moved);
 assert.deepEqual(moved.sheets[0].images.map(i=>i.row),[43]);assert.equal(moved.sheets[0].rawValues[41][2].value,'');
 assert.deepEqual([43,44,45].map(n=>JSON.parse(moved.sheets[0].notes[n-1][7]).unit),[1,2,3]);
 const comments=strFromU8(unzipSync(Buffer.from(moved.xlsxBase64,'base64'))['xl/comments/aroundg-1.xml']);assert.doesNotMatch(comments,/ref="H42"/);
});

test('receipt relocation rejects occupied rows, stale views, merged rows and changed receipt totals without mutation',async t=>{
 const {ledger,options}=await setup(t),first=await ledger.load();await ledger.record(purchase,{sheetId:1,row:575,revision:first.revision});let current=await ledger.load();
 for(const [destination,change,error] of [[3,{},'OCCUPIED'],[42,{purchasePrice:100002},'EXISTING_CONFLICT'],[42,{quantity:2},'EXISTING_CONFLICT']]) {
  await assert.rejects(ledger.record({...purchase,...change},{sheetId:1,row:destination,revision:current.revision}),new RegExp(error));assert.equal((await ledger.load()).revision,current.revision);
 }
 await assert.rejects(ledger.record(purchase,{sheetId:1,row:42,revision:'stale'}),/CELL_CONFLICT/);
 for(const kind of ['note','image','manual','merge']) {
  const changed=structuredClone(current),s=changed.sheets[0];
  if(kind==='note')s.notes[41][0]='keep note';if(kind==='image')s.images=[{row:42,column:8,url:'data:image/png;base64,iVBORw=='}];
  if(kind==='manual')s.rawValues[41][19]={type:'number',value:'123'};if(kind==='merge')s.merges.push({row:41,column:0,rows:1,columns:2});
  await saveLedgerWorkbook(options.path,changed,options.encrypt);
  await assert.rejects(ledger.record(purchase,{sheetId:1,row:42,revision:current.revision}),/OCCUPIED|MERGED/);
  assert.equal((await ledger.load()).sheets[0].rawValues[574][2].value,'NEW-001');
 }
});

test('history relocation requires existing receipts and a failed backup or commit leaves all original rows intact',async t=>{
 const {ledger,options}=await setup(t),first=await ledger.load();
 await assert.rejects(ledger.record(purchase,{sheetId:1,row:42,revision:first.revision},{existingOnly:true}),/EXISTING_NOT_FOUND/);
 await ledger.record(purchase,{sheetId:1,row:575,revision:first.revision});const before=await readFile(options.path),current=await ledger.load();
 for(const failure of ['backup','commit']) {
  const broken=createLocalLedger({...options,save:async(path,...args)=>{if(failure==='backup'?path.includes('before-receipt-move'):path===options.path)throw Error('DISK_FULL');return saveLedgerWorkbook(path,...args);}});
  await assert.rejects(broken.record(purchase,{sheetId:1,row:42,revision:current.revision},{existingOnly:true}),/DISK_FULL/);
  assert.deepEqual(await readFile(options.path),before);
 }
});

test('moving beyond a header total extends its range and preserves destination defaults',async t=>{
 const {ledger}=await setup(t),first=await ledger.load();await ledger.record(purchase);
 let current=await ledger.load();current=await ledger.edit({sheetId:1,row:900,column:17,revision:current.revision,expected:{type:'text',value:''},next:{type:'number',value:'4890'}});
 const moved=await ledger.record(purchase,{sheetId:1,row:900,revision:current.revision});assert.deepEqual(moved.rowNumbers,[900,901,902]);
 const saved=await ledger.load();assert.equal(saved.sheets[0].formulas[0][19],'=SUM(T3:T902)');assert.equal(saved.sheets[0].rawValues[899][16].value,'4890');
});

test('visually blank whitespace cells allow new purchases and relocation while numeric zero is occupied',async t=>{
 const {ledger}=await setup(t),first=await ledger.load();
 let current=await ledger.change({action:'paste',sheetId:1,revision:first.revision,range:{row:42,column:1},payload:{schema:LEDGER_COPY_SCHEMA,cells:[Array.from({length:14},()=>({type:'text',value:' \t\u00a0'}))]}});
 const initial=await ledger.record(purchase,{sheetId:1,row:42,revision:current.revision});assert.deepEqual(initial.rowNumbers,[42,43,44]);
 current=await ledger.load();
 current=await ledger.change({action:'paste',sheetId:1,revision:current.revision,range:{row:50,column:1},payload:{schema:LEDGER_COPY_SCHEMA,cells:[Array.from({length:14},()=>({type:'text',value:' '}))]}});
 assert.equal((await ledger.record(purchase,{sheetId:1,row:50,revision:current.revision})).moved,true);
 current=await ledger.load();current=await ledger.edit({sheetId:1,row:60,column:14,revision:current.revision,expected:{type:'text',value:''},next:{type:'number',value:'0'}});
 await assert.rejects(ledger.record(purchase,{sheetId:1,row:60,revision:current.revision}),/DESTINATION_OCCUPIED/);
});

test('typed purchase dates repair numeric/currency display once and export date styles without changing original style definitions',async t=>{
 const book=fixture(),s=book.sheets[0],date={type:'date',value:'2026-09-16T15:00:00.000Z'};
 s.rawValues[2][12]=date;s.numberFormats[2][12]='#,##0원';
 const files=unzipSync(Buffer.from(book.xlsxBase64,'base64'));
 files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace('<sheetData>','<sheetData><row r="3"><c r="M3" s="1"><v>46282</v></c></row>'));
 const bytes=Buffer.from(zipSync(files));book.xlsxBase64=bytes.toString('base64');book.xlsxSha256=createHash('sha256').update(bytes).digest('hex');
 const {ledger,options,dir}=await setup(t,book),repaired=await ledger.load();
 assert.equal(repaired.sheets[0].displayValues[2][12],'2026-09-17');assert.deepEqual(repaired.sheets[0].rawValues[2][12],date);
 const backup=await readLedgerWorkbook(repaired.local.dateFormatRepair.backupPath,options.decrypt);assert.equal(backup.sheets[0].numberFormats[2][12],'#,##0원');
 const again=await createLocalLedger(options).load();assert.equal(again.revision,repaired.revision);
 await ledger.export(join(dir,'dates.xlsx'));const parts=unzipSync(await readFile(join(dir,'dates.xlsx'))),parse=part=>new DOMParser().parseFromString(strFromU8(part),'application/xml');
 const cell=Array.from(parse(parts['xl/worksheets/sheet1.xml']).getElementsByTagName('c')).find(c=>c.getAttribute('r')==='M3');assert.equal(cell.textContent,'46282');
 const styles=parse(parts['xl/styles.xml']),old=parse(files['xl/styles.xml']);
 const xfs=styles.getElementsByTagName('cellXfs')[0],original=old.getElementsByTagName('cellXfs')[0];
 for(let i=0;i<4;i++)assert.equal(xfs.childNodes[i].toString(),original.childNodes[i].toString());
 const dateStyle=xfs.childNodes[Number(cell.getAttribute('s'))],id=dateStyle.getAttribute('numFmtId');
 assert.equal(dateStyle.getElementsByTagName('alignment')[0].getAttribute('horizontal'),'center');
 assert.equal(Array.from(styles.getElementsByTagName('numFmt')).find(n=>n.getAttribute('numFmtId')===id).getAttribute('formatCode'),'yyyy-mm-dd');
 assert.deepEqual(parts['xl/media/image1.png'],files['xl/media/image1.png']);
});

test('moving a receipt keeps date semantics, category metadata and formulas without rereading the catalog',async t=>{
 const {options}=await setup(t,calculationFixture());let reads=0;
 const ledger=createLocalLedger({...options,categories:async()=>{reads++;return [{articleNumber:'NEW-001',categoryName:'의류'}];}});
 let current=await ledger.load();await ledger.record(purchase,{sheetId:1,row:575,revision:current.revision});current=await ledger.load();
 const beforeReads=reads;await ledger.record(purchase,{sheetId:1,row:42,revision:current.revision});const moved=await ledger.load();
 assert.equal(reads,beforeReads);assert.equal(moved.sheets[0].displayValues[41][12],'2026-09-17');
 assert.equal(moved.local.categories[1].rows[42].category,'의류');assert.match(moved.sheets[0].formulas[41][18],/N42/);
 const pasted=await ledger.change({action:'paste',sheetId:1,revision:moved.revision,range:{row:50,column:13},payload:{schema:LEDGER_COPY_SCHEMA,cells:[[{type:'date',value:'2026-09-17'}]]}});
 assert.equal(pasted.sheets[0].displayValues[49][12],'2026-09-17');
});

test('failed date-format backup preserves the current workbook',async t=>{
 const {options}=await setup(t),ledger=createLocalLedger(options),book=await ledger.load();book.sheets[0].rawValues[2][12]={type:'date',value:'2026-09-16T15:00:00.000Z'};
 await saveLedgerWorkbook(options.path,book,options.encrypt);const bytes=await readFile(options.path);
 const failing=createLocalLedger({...options,save:async(path,...args)=>{if(path.includes('before-date-formats'))throw Error('BACKUP_FAILED');return saveLedgerWorkbook(path,...args);}});
 await assert.rejects(failing.load(),/BACKUP_FAILED/);assert.deepEqual(await readFile(options.path),bytes);
});

test('selected-row writes reject stale/invalid destinations and any occupied unit atomically',async t=>{
 const {ledger}=await setup(t),current=await ledger.load();
 for(const destination of [{sheetId:2,row:42,revision:current.revision},{sheetId:1,row:2,revision:current.revision},{sheetId:1,row:999,revision:current.revision},{sheetId:1,row:42,revision:'stale'}])await assert.rejects(ledger.record(purchase,destination),/PURCHASE_DESTINATION_INVALID|CELL_CONFLICT/);
 // First two rows are blank, but the third contains an existing product.
 await assert.rejects(ledger.record(purchase,{sheetId:1,row:3,revision:current.revision}),/PURCHASE_DESTINATION_OCCUPIED/);
 assert.equal((await ledger.load()).revision,current.revision);assert.equal((await ledger.load()).sheets[0].rawValues[2][2].value,'');
});

test('selected rows with embedded pictures, receipt notes or merges are never overwritten',async t=>{
 for(const kind of ['image','note','merge']) {
  const book=fixture(),s=book.sheets[0];
  if(kind==='image')s.images=[{row:3,column:8,url:'data:image/png;base64,iVBORw=='}];
  if(kind==='note')s.notes[2][7]='existing receipt';
  if(kind==='merge')s.merges.push({row:2,column:0,rows:1,columns:2});
  const {ledger,options}=await setup(t,book);let current=await ledger.load();
  if(kind==='image'){current.sheets[0].images=s.images;await saveLedgerWorkbook(options.path,current,options.encrypt);}
  await assert.rejects(ledger.record({...purchase,quantity:1},{sheetId:1,row:3,revision:current.revision}),/PURCHASE_DESTINATION_OCCUPIED|PURCHASE_DESTINATION_MERGED/);
  assert.equal((await ledger.load()).revision,current.revision);
 }
});

test('a verified payment card fills all purchased units and an existing receipt without overwriting a manual card',async t=>{
 const book=calculationFixture(),s=book.sheets[0];s.validations[4][14]={type:'other'};
 const {ledger}=await setup(t,book);let current=await ledger.load();
 const withCard={...purchase,cardIssuer:'삼성'};
 await ledger.record(withCard,{sheetId:1,row:42,revision:current.revision});current=await ledger.load();
 assert.deepEqual([42,43,44].map(n=>current.sheets[0].rawValues[n-1][14].value),['삼성','삼성','삼성']);
 const edited=await ledger.edit({sheetId:1,row:43,column:15,revision:current.revision,
   expected:current.sheets[0].rawValues[42][14],next:{type:'text',value:'현대'}});
 assert.equal(edited.sheets[0].rawValues[42][14].value,'현대');
 assert.deepEqual(edited.sheets[0].validations[4][14],s.validations[4][14]);
 await ledger.record(withCard,{sheetId:1,row:42,revision:edited.revision});
 assert.equal((await ledger.load()).sheets[0].rawValues[42][14].value,'현대');
});

test('unrecognized validation still blocks unrelated cells while the card column remains editable',async t=>{
 const book=calculationFixture(),s=book.sheets[0];s.validations[4][14]={type:'other'};s.validations[4][2]={type:'other'};
 const {ledger}=await setup(t,book),current=await ledger.load();
 const edit=(column,value)=>({sheetId:1,row:5,column,revision:current.revision,
   expected:current.sheets[0].rawValues[4][column-1],next:{type:'text',value}});
 const changed=await ledger.edit(edit(15,'삼성'));
 assert.equal(changed.sheets[0].rawValues[4][14].value,'삼성');
 await assert.rejects(ledger.edit({...edit(3,'DIFFERENT'),revision:changed.revision}),/CELL_VALIDATION_REVIEW/);
});

test('clear dropdown and formula contents atomically, preserve styles/rules and recalculate/export blanks',async t=>{
 const book=fixture(),s=book.sheets[0];s.validations[4][11]={type:'list',values:['구매완료']};s.rawValues[4][11]={type:'text',value:'구매완료'};s.displayValues[4][11]='구매완료';
 const {ledger,dir,options}=await setup(t,book),current=await ledger.load();
 const next=await ledger.change({action:'clear',sheetId:1,revision:current.revision,range:{row:5,column:12,endColumn:20}});
 assert.equal(next.sheets[0].rawValues[4][11].value,'');assert.equal(next.sheets[0].formulas[4][19],'');assert.equal(next.sheets[0].calculatedValues[0][19].value,0);
 assert.deepEqual(next.sheets[0].validations[4][11],s.validations[4][11]);assert.equal(next.sheets[0].numberFormats[4][13],'#,##0');
 assert.equal((await createLocalLedger(options).view()).sheets[0].rawValues[4][13].value,'');
 await ledger.export(join(dir,'clear.xlsx'));const parts=unzipSync(await readFile(join(dir,'clear.xlsx'))),doc=new DOMParser().parseFromString(strFromU8(parts['xl/worksheets/sheet1.xml']),'application/xml');
 const cell=Array.from(doc.getElementsByTagName('c')).find(c=>c.getAttribute('r')==='N5');assert.equal(cell.getAttribute('s'),'3');assert.equal(cell.textContent,'');
 await assert.rejects(ledger.change({action:'clear',sheetId:1,revision:next.revision,range:{row:1,column:1,endColumn:2}}),/CELL_MERGED/);
 assert.equal((await ledger.load()).revision,next.revision);
});

test('typed copy/paste shifts mixed references, preserves leading zeros and dates, and rejects an invalid whole block',async t=>{
 const {ledger}=await setup(t),current=await ledger.load();
 const selected={sheetId:1,revision:current.revision,range:{row:5,column:16,endColumn:20}};
 const payload=parseLedgerClipboard(ledgerClipboardData(await ledger.copy(selected)));
 const next=await ledger.change({action:'paste',sheetId:1,revision:current.revision,range:{row:6,column:16},payload});
 assert.equal(next.sheets[0].formulas[5][17],'=IF(J6="","",J6-N6-P6-Q6)');assert.equal(next.sheets[0].rawValues[5][16].value,'3000');
 assert.equal(shiftLedgerFormula('=IF(A5="A5",$B5+C$2+$D$3+LOG10(100)+TAB1!A5,\'시트5\'!B5)',2,1),'=IF(B7="A5",$B7+D$2+$D$3+LOG10(100)+TAB1!B7,\'시트5\'!C7)');
 assert.equal(shiftLedgerFormula('=A1+$B1',-1,-1),'=#REF!+#REF!');
 const pasted=await ledger.change({action:'paste',sheetId:1,revision:next.revision,range:{row:7,column:1},payload:{schema:LEDGER_COPY_SCHEMA,cells:[[{type:'text',value:'001-ABC'},{type:'date',value:'2026-09-20T15:00:00.000Z'}]]}});
 assert.equal(pasted.sheets[0].rawValues[6][0].value,'001-ABC');assert.equal(pasted.sheets[0].rawValues[6][1].value,'2026-09-20T15:00:00.000Z');
 const before=await ledger.load();
 await assert.rejects(ledger.change({action:'paste',sheetId:1,revision:before.revision,range:{row:8,column:1},payload:{schema:LEDGER_COPY_SCHEMA,cells:[[{type:'text',value:'must not save'},{type:'number',value:'bad'}]]}}),/CELL_NUMBER_INVALID/);
 assert.equal((await ledger.load()).revision,before.revision);
 await assert.rejects(ledger.change({action:'paste',sheetId:1,revision:current.revision,range:{row:8,column:1},payload}),/CELL_CONFLICT/);
});

test('resize persists through restart and patches only the chosen Excel dimensions including grouped columns',async t=>{
 const book=fixture(),files=unzipSync(Buffer.from(book.xlsxBase64,'base64'));
 files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace('<sheetData>','<cols><col min="1" max="4" width="12" style="2" hidden="0"/></cols><sheetData>'));
 const bytes=Buffer.from(zipSync(files));book.xlsxBase64=bytes.toString('base64');book.xlsxSha256=createHash('sha256').update(bytes).digest('hex');
 const {ledger,dir,options}=await setup(t,book),current=await ledger.load();
 const next=await ledger.resize({sheetId:1,revision:current.revision,changes:[{axis:'column',index:3,pixels:215},{axis:'row',index:5,pixels:80}]});
 assert.equal(next.sheets[0].columnWidths[3],215);assert.equal((await createLocalLedger(options).view()).sheets[0].rowHeights[5],80);
 await ledger.export(join(dir,'resize.xlsx'));const after=unzipSync(await readFile(join(dir,'resize.xlsx'))),doc=new DOMParser().parseFromString(strFromU8(after['xl/worksheets/sheet1.xml']),'application/xml');
 const cols=Array.from(doc.getElementsByTagName('col'));assert.deepEqual(cols.map(c=>[c.getAttribute('min'),c.getAttribute('max'),c.getAttribute('width'),c.getAttribute('style')]),[['1','2','12','2'],['3','3','30','2'],['4','4','12','2']]);
 assert.equal(Array.from(doc.getElementsByTagName('row')).find(r=>r.getAttribute('r')==='5').getAttribute('ht'),'60');assert.deepEqual(after['xl/styles.xml'],files['xl/styles.xml']);
 await assert.rejects(ledger.resize({sheetId:1,revision:next.revision,changes:[{axis:'column',index:3,pixels:NaN}]}),/CELL_DIMENSION_INVALID/);
 assert.equal((await ledger.load()).revision,next.revision);
});

test('clipboard round-trip handles quoted tabs/newlines and keeps external formula-like strings literal',()=>{
 const payload={schema:LEDGER_COPY_SCHEMA,row:4,column:2,cells:[[{type:'text',value:'001'},{type:'text',value:'줄1\n줄2\t"인용"'},{type:'formula',value:'=A4*2'}]]};
 const data=ledgerClipboardData(payload);assert.deepEqual(parseLedgerClipboard(data),payload);
 assert.deepEqual(parseLedgerClipboard({text:data.text}).cells[0].map(c=>c.value),['001','줄1\n줄2\t"인용"','=A4*2']);
 assert.equal(parseLedgerClipboard({text:'=WEBSERVICE("https://example.test")\r\n'}).cells[0][0].type,'text');
 assert.throws(()=>parseLedgerClipboard({text:''}),/CELL_CLIPBOARD_EMPTY/);
});

test('copied embedded pictures survive clearing the source and copying into an existing drawing without duplicate worksheet drawings',async t=>{
 const {ledger,dir}=await setup(t),current=await ledger.load();
 const payload={schema:LEDGER_COPY_SCHEMA,row:5,column:8,cells:[[{type:'text',value:''}]],images:[{row:0,column:0,url:'data:image/png;base64,iVBORw=='}]};
 let next=await ledger.change({action:'paste',sheetId:1,revision:current.revision,range:{row:5,column:8},payload});
 const copy=await ledger.copy({sheetId:1,revision:next.revision,range:{row:5,column:8}});
 next=await ledger.change({action:'clear',sheetId:1,revision:next.revision,range:{row:5,column:8}});
 next=await ledger.change({action:'paste',sheetId:1,revision:next.revision,range:{row:6,column:8,endRow:7},payload:copy});
 assert.deepEqual(next.sheets[0].images.map(i=>i.row),[6,7]);
 const book=await ledger.load();readLedgerImages(book);assert.deepEqual(book.sheets[0].images.map(i=>i.row),[6,7]);
 await ledger.export(join(dir,'images.xlsx'));const parts=unzipSync(await readFile(join(dir,'images.xlsx'))),doc=new DOMParser().parseFromString(strFromU8(parts['xl/worksheets/sheet1.xml']),'application/xml');assert.equal(doc.getElementsByTagName('drawing').length,1);
 assert.equal(Array.from(doc.getElementsByTagName('c')).some(c=>['H6','H7'].includes(c.getAttribute('r'))),false,'picture-only cells keep their implicit blank style');
});

