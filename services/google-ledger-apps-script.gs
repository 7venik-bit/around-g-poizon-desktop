const SPREADSHEET_ID = '1x-qj5rX6fv_Xqzmv-NHD2L8_5VAMyDegL-G1gcoS8Xc';
const SHEET_NAME = '1-구매완료';

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return json_({ ok: true, service: 'Around G 구매장부', sheet: SHEET_NAME, capabilities: ['workbook.read.v1', 'workbook.edit.v1'] });
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
    const last = Math.max(2, sheet.getLastRow());
    const values = last > 2 ? sheet.getRange(3, 1, last - 2, 30).getDisplayValues() : [];
    const same = values.findIndex(r => {
      const link = String(r[1] || '').replace(/[?#].*$/, '');
      const code = String(r[2] || '').toUpperCase().replace(/[^0-9A-Z가-힣]/g, '');
      const size = String(r[6] || r[5] || '').toUpperCase().replace(/\s+/g, '');
      const date = Utilities.formatDate(new Date(r[12] || 0), 'Asia/Seoul', 'yyyy-MM-dd');
      const price = Number(String(r[13] || '').replace(/[^0-9.-]/g, '')) || 0;
      return (link && link === row.purchaseUrl && size === String(row.krSize || row.euSize).toUpperCase().replace(/\s+/g, ''))
        || (code && code === row.articleNumber && size === String(row.krSize || row.euSize).toUpperCase().replace(/\s+/g, '') && date === row.purchaseDate && price === Number(row.purchasePrice));
    });
    if (same >= 0) return json_({ ok: true, duplicate: true, rowNumber: same + 3 });
    const target = sheet.getLastRow() + 1;
    const output = Array(30).fill('');
    output[0]=row.brand; output[1]=row.purchaseUrl; output[2]=row.articleNumber; output[3]=row.modelName;
    output[4]=row.gender; output[5]=row.euSize; output[6]=row.krSize; output[7]=row.imageUrl;
    output[11]=row.status === '반품중' ? '반품중' : '구매완료'; output[12]=row.purchaseDate; output[13]=Number(row.purchasePrice);
    sheet.getRange(target, 1, 1, 30).setValues([output]);
    sheet.getRange(target - 1, 1, 1, 30).copyTo(sheet.getRange(target, 1, 1, 30), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sheet.getRange(target, 1, 1, 30).setValues([output]);
    const verify = sheet.getRange(target, 1, 1, 14).getDisplayValues()[0];
    return json_({ ok: verify[2] === row.articleNumber && verify[11] === output[11], duplicate: false, rowNumber: target });
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
