const SPREADSHEET_ID = '1x-qj5rX6fv_Xqzmv-NHD2L8_5VAMyDegL-G1gcoS8Xc';
const SHEET_NAME = '1-구매완료';

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return json_({ ok: true, service: 'Around G 구매장부', sheet: SHEET_NAME, capabilities: ['workbook.read.v1', 'workbook.edit.v1', 'purchase.image.v1', 'purchase.units.v1'] });
}

// A literal HTTPS image formula fits the original photo cell, and remains a
// formula in workbook reads/exports. Never evaluate caller-supplied formulas.
function purchaseImageFormula_(value) {
  const url=String(value || '').trim();
  if (!/^https:\/\/[a-z0-9.-]+(?::443)?\/[^\s<>"\\]*$/i.test(url) || /\.svg(?:[?#]|$)/i.test(url)) return '';
  return '=IMAGE("' + url + '",1)';
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('LEDGER_SECRET');
    if (!secret || body.secret !== secret) return json_({ ok: false, code: 'UNAUTHORIZED' });
    if (body.action === 'workbook.edit') return json_(editWorkbookCell_(body.edit));
    if (body.action && body.action !== 'workbook.read') return json_({ok:false,code:'UNKNOWN_ACTION'});
    if (body.action === 'workbook.read') return json_({ ok: true, workbook: readOriginalWorkbook_() });
    const row = body.row || {};
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return json_({ ok: false, code: 'SHEET_NOT_FOUND' });
    return json_(appendPurchaseUnits_(sheet, row));
  } catch (error) {
    return json_({ ok: false, code: 'WRITE_FAILED', message: String(error && error.message || error) });
  } finally { lock.releaseLock(); }
}


// Read-only migration: never call setValues, insert/delete, sort or formula repair.
function readOriginalWorkbook_() {
  const file = DriveApp.getFileById(SPREADSHEET_ID);
  const revision = file.getLastUpdated().toISOString();
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = book.getSheets().map(sheet => {
    const range = sheet.getDataRange();
    const formulas = range.getFormulas();
    const rawValues = range.getValues().map((row,r) => row.map((value,c) => workbookCellValue_(value,formulas[r][c])));
    return {
      id: sheet.getSheetId(), name: sheet.getName(), hidden: sheet.isSheetHidden(),
      rowCount: sheet.getMaxRows(), columnCount: sheet.getMaxColumns(),
      frozenRows: sheet.getFrozenRows(), frozenColumns: sheet.getFrozenColumns(),
      displayValues: range.getDisplayValues(), formulas, rawValues,
      validations: range.getDataValidations().map(row => row.map(workbookValidation_)),
      backgrounds: range.getBackgrounds(), fontColors: range.getFontColors(),
      fontWeights: range.getFontWeights(), numberFormats: range.getNumberFormats(),
      notes: range.getNotes(),
      merges: range.getMergedRanges().map(r => ({row:r.getRow()-1,column:r.getColumn()-1,rows:r.getNumRows(),columns:r.getNumColumns()}))
    };
  });
  const response = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/export?format=xlsx', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('WORKBOOK_EXPORT_FAILED');
  const bytes = response.getContent();
  if (bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75) throw new Error('WORKBOOK_EXPORT_INVALID');
  if (DriveApp.getFileById(SPREADSHEET_ID).getLastUpdated().toISOString() !== revision) throw new Error('WORKBOOK_CHANGED_DURING_READ');
  const checksum = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
  return {schemaVersion:1, spreadsheetId:SPREADSHEET_ID, title:book.getName(), timeZone:book.getSpreadsheetTimeZone(), revision,
    capturedAt:new Date().toISOString(), sheets, xlsxBase64:Utilities.base64Encode(bytes), xlsxSha256:checksum};
}

function workbookCellValue_(value, formula) {
  if (formula) return {type:'formula', value:formula};
  if (value instanceof Date) return {type:'date', value:value.toISOString()};
  if (typeof value === 'number') return {type:'number', value:String(value)};
  if (typeof value === 'boolean') return {type:'boolean', value:String(value)};
  return {type:'text', value:String(value == null ? '' : value)};
}

function editWorkbookCell_(edit) {
  if (!edit || !Number.isInteger(edit.sheetId) || !Number.isInteger(edit.row) || !Number.isInteger(edit.column) || edit.row < 1 || edit.column < 1) return {ok:false,code:'CELL_ADDRESS_INVALID'};
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = book.getSheets().find(s => s.getSheetId() === edit.sheetId);
  if (!sheet || edit.row > sheet.getMaxRows() || edit.column > sheet.getMaxColumns()) return {ok:false,code:'CELL_ADDRESS_INVALID'};
  if (DriveApp.getFileById(SPREADSHEET_ID).getLastUpdated().toISOString() !== edit.revision) return {ok:false,code:'CELL_CONFLICT'};
  const cell = sheet.getRange(edit.row,edit.column);
  if (!cell.canEdit()) return {ok:false,code:'CELL_PROTECTED'};
  if (cell.isPartOfMerge()) {
    const merged = cell.getMergedRanges()[0];
    if (!merged || merged.getRow() !== edit.row || merged.getColumn() !== edit.column) return {ok:false,code:'CELL_MERGED'};
  }
  const current = workbookCellValue_(cell.getValue(),cell.getFormula());
  if (!edit.expected || current.type !== edit.expected.type || current.value !== edit.expected.value) return {ok:false,code:'CELL_CONFLICT'};
  const input = edit.next;
  if (!input || typeof input.value !== 'string' || input.value.length > 50000) return {ok:false,code:'CELL_VALUE_INVALID'};
  let value;
  if (input.type === 'number') {
    // Never strip currency/shipping text or silently round money.
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.value) || input.value.replace(/[-.]/g,'').replace(/^0+/,'').length > 15 || !Number.isFinite(Number(input.value))) return {ok:false,code:'CELL_NUMBER_INVALID'};
    value = Number(input.value);
  } else if (input.type === 'boolean') {
    if (!['true','false'].includes(input.value)) return {ok:false,code:'CELL_VALUE_INVALID'};
    value = input.value === 'true';
  } else if (input.type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return {ok:false,code:'CELL_DATE_INVALID'};
    try {value = Utilities.parseDate(input.value,book.getSpreadsheetTimeZone(),'yyyy-MM-dd');}
    catch(error) {return {ok:false,code:'CELL_DATE_INVALID'};}
    if (Utilities.formatDate(value,book.getSpreadsheetTimeZone(),'yyyy-MM-dd') !== input.value) return {ok:false,code:'CELL_DATE_INVALID'};
  } else if (input.type === 'formula') {
    if (!input.value.startsWith('=')) return {ok:false,code:'CELL_FORMULA_INVALID'};
    value = input.value;
  } else if (input.type === 'text') { value = input.value; }
  else return {ok:false,code:'CELL_VALUE_INVALID'};
  const rule = cell.getDataValidation();
  if (rule) {
    const criteria = rule.getCriteriaType(), args = rule.getCriteriaValues();
    const types = SpreadsheetApp.DataValidationCriteria;
    let allowed;
    if (criteria === types.VALUE_IN_LIST) allowed = args[0].map(String).includes(String(value));
    else if (criteria === types.VALUE_IN_RANGE) allowed = args[0].getValues().flat().map(String).includes(String(value));
    else if (criteria === types.CHECKBOX) allowed = args.length ? args.map(String).includes(String(value)) : typeof value === 'boolean';
    else return {ok:false,code:'CELL_VALIDATION_REVIEW'};
    if (!allowed) return {ok:false,code:'CELL_VALIDATION_FAILED'};
  }
  if (input.type === 'text') {
    // setValue interprets leading '=' as a formula; rich text writes a literal.
    if (value === '') cell.clearContent();
    else cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(value).build());
  } else if (input.type === 'formula') { cell.setFormula(value); }
  else { cell.setValue(value); }
  SpreadsheetApp.flush();
  const actual = workbookCellValue_(cell.getValue(),cell.getFormula());
  const expected = workbookCellValue_(value,input.type === 'formula' ? value : '');
  if (actual.type !== expected.type || actual.value !== expected.value) return {ok:false,code:'CELL_WRITE_VERIFY_FAILED',written:true};
  try {return {ok:true,written:true,workbook:readOriginalWorkbook_()};}
  catch(error) {return {ok:false,written:true,code:'CELL_SAVED_REFRESH_REQUIRED'};}
}


function workbookValidation_(rule) {
  if (!rule) return null;
  const type = rule.getCriteriaType(), args = rule.getCriteriaValues(), types = SpreadsheetApp.DataValidationCriteria;
  if (type === types.VALUE_IN_LIST) return {type:'list', values:args[0].map(String)};
  if (type === types.VALUE_IN_RANGE) {
    const range = args[0];
    if (range.getNumRows() * range.getNumColumns() > 5000) return {type:'other'};
    return {type:'list',values:range.getValues().flat().map(String)};
  }
  if (type === types.CHECKBOX) return {type:'list', values:args.length ? args.map(String) : ['true','false']};
  return {type:'other'};
}

// Each purchased unit occupies one original ledger row. Notes identify the
// receipt line without adding columns or merging separate, identical purchases.
function appendPurchaseUnits_(sheet, row) {
  const quantity = Number(row.quantity == null ? 1 : row.quantity);
  const total = Number(row.purchasePrice);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000
      || !Number.isSafeInteger(total) || total < quantity) return {ok:false,code:'PURCHASE_UNITS_INVALID'};
  const imageFormula = purchaseImageFormula_(row.imageUrl);
  if (!imageFormula) return {ok:false,code:'PRODUCT_IMAGE_REQUIRED'};
  const evidence = row.orderEvidence || {};
  const orderNumber = String(row.orderNumber || '').trim();
  const lineId = String(evidence.orderLineId || row.orderLineId || '').trim();
  if (!orderNumber || !lineId) return {ok:false,code:'ORDER_EVIDENCE_REQUIRED'};
  const key = JSON.stringify([orderNumber, lineId]);
  const prices = Array.from({length:quantity}, (_, i) => Math.floor(total / quantity) + (i < total % quantity ? 1 : 0));
  const output = prices.map(price => {
    const out = Array(14).fill('');
    out[0]=String(row.brand || ''); out[1]=String(row.purchaseUrl || ''); out[2]=String(row.articleNumber || '');
    out[3]=String(row.modelName || ''); out[4]=String(row.gender || '');
    out[5]=String(row.euSize || ''); out[6]=String(row.krSize || ''); out[7]=imageFormula;
    out[11]=row.status === '반품중' ? '반품중' : '구매완료';
    out[12]=String(row.purchaseDate || ''); out[13]=price;
    // Only the photo cell may contain an executable formula.
    for (let c=0;c<out.length;c++) if (c!==7 && typeof out[c]==='string' && /^[=+@]/.test(out[c])) out[c]="'"+out[c];
    return out;
  });
  const last = Math.max(2, sheet.getLastRow());
  const scanEnd = Math.min(sheet.getMaxRows(), last + quantity);
  const notes = scanEnd > 2 ? sheet.getRange(3,8,scanEnd-2,1).getNotes() : [];
  const found = [];
  notes.forEach((note, index) => {
    try {
      const mark=JSON.parse(note[0]);
      if (mark.schema==='around-g.purchase.units.v1' && mark.key===key) found.push({row:index+3,mark:mark});
    } catch (_) {}
  });
  const verify = (numbers) => numbers.every((number,index) => {
    const values=sheet.getRange(number,1,1,14).getValues()[0];
    const date=values[12] instanceof Date ? Utilities.formatDate(values[12],'Asia/Seoul','yyyy-MM-dd') : String(values[12]);
    return [0,1,2,3,4,5,6,11].every(c => String(values[c])===output[index][c])
      && date===output[index][12] && Number(values[13])===prices[index]
      && sheet.getRange(number,8).getFormula()===imageFormula;
  });
  if (found.length) {
    found.sort((a,b)=>a.mark.unit-b.mark.unit);
    if (found.length!==quantity || found.some((item,index)=>item.mark.unit!==index+1
        || item.mark.quantity!==quantity || item.mark.total!==total)) return {ok:false,code:'PURCHASE_RECEIPT_CONFLICT'};
    const numbers=found.map(item=>item.row);
    if (!verify(numbers)) return {ok:false,code:'PURCHASE_RECEIPT_REVIEW'};
    return {ok:true,duplicate: true,rowNumber:numbers[0],rowNumbers:numbers,unitPrices:prices,quantity:quantity,imageStatus:'formula'};
  }
  const target=last+1;
  if (target+quantity-1>sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),target+quantity-1-sheet.getMaxRows());
  const marks=prices.map((_,i)=>[JSON.stringify({schema:'around-g.purchase.units.v1',key:key,unit:i+1,quantity:quantity,total:total})]);
  // Reserve the receipt before writing. An interrupted write is flagged for
  // review on retry, never silently appended a second time.
  sheet.getRange(target,8,quantity,1).setNotes(marks);
  sheet.getRange(target,1,quantity,14).setValues(output);
  sheet.setRowHeights(target,quantity,72);
  SpreadsheetApp.flush();
  const numbers=prices.map((_,i)=>target+i);
  if (!verify(numbers)) return {ok:false,code:'PURCHASE_WRITE_VERIFY_FAILED',written:true,rowNumbers:numbers};
  return {ok:true,duplicate:false,rowNumber:target,rowNumbers:numbers,unitPrices:prices,quantity:quantity,imageStatus:'formula'};
}
