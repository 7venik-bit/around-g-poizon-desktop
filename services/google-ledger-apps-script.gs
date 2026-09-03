const SPREADSHEET_ID = '1x-qj5rX6fv_Xqzmv-NHD2L8_5VAMyDegL-G1gcoS8Xc';
const SHEET_NAME = '1-구매완료';

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return json_({ ok: true, service: 'Around G 구매장부', sheet: SHEET_NAME });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('LEDGER_SECRET');
    if (!secret || body.secret !== secret) return json_({ ok: false, code: 'UNAUTHORIZED' });
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
