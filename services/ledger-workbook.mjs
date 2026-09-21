import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export const LEDGER_SPREADSHEET_ID = '1x-qj5rX6fv_Xqzmv-NHD2L8_5VAMyDegL-G1gcoS8Xc';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateLedgerWorkbook(input) {
  if (input?.schemaVersion !== 1 || input.spreadsheetId !== LEDGER_SPREADSHEET_ID || !Array.isArray(input.sheets) || !input.sheets.length) throw new Error('WORKBOOK_INVALID');
  const ids = new Set();
  for (const sheet of input.sheets) {
    if (!Number.isInteger(sheet.id) || ids.has(sheet.id) || !sheet.name || !Array.isArray(sheet.displayValues) || !Array.isArray(sheet.formulas) || sheet.displayValues.length !== sheet.formulas.length) throw new Error('WORKBOOK_INVALID');
    ids.add(sheet.id);
    for (let r = 0; r < sheet.displayValues.length; r++) {
      if (!Array.isArray(sheet.displayValues[r]) || !Array.isArray(sheet.formulas[r]) || sheet.displayValues[r].length !== sheet.formulas[r].length || sheet.displayValues[r].some(v => typeof v !== 'string') || sheet.formulas[r].some(v => typeof v !== 'string')) throw new Error('WORKBOOK_INVALID');
    }
  }
  if (typeof input.xlsxBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.xlsxBase64)) throw new Error('WORKBOOK_EXPORT_INVALID');
  const bytes = Buffer.from(input.xlsxBase64, 'base64');
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50 || digest(bytes) !== input.xlsxSha256) throw new Error('WORKBOOK_EXPORT_CHECKSUM_FAILED');
  return input;
}
export function workbookView(input) {
  const { xlsxBase64, xlsxSha256, ...view } = validateLedgerWorkbook(input);
  return view;
}
// No normalization, recalculation, deduplication or destination-sheet writes.
export async function saveLedgerWorkbook(path, input, encrypt) {
  validateLedgerWorkbook(input);
  const raw = JSON.stringify(input);
  const encrypted = encrypt(raw);
  const temp = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temp, encrypted, { mode: 0o600, flag: 'wx' });
    if (!(await readFile(temp)).equals(Buffer.from(encrypted))) throw new Error('WORKBOOK_SAVE_VERIFY_FAILED');
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}
export async function readLedgerWorkbook(path, decrypt) {
  return validateLedgerWorkbook(JSON.parse(decrypt(await readFile(path))));
}
export async function exportLedgerWorkbook(path, input) {
  validateLedgerWorkbook(input);
  const bytes = Buffer.from(input.xlsxBase64, 'base64');
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, bytes, { flag: 'wx' });
    if (digest(await readFile(temp)) !== input.xlsxSha256) throw new Error('WORKBOOK_EXPORT_VERIFY_FAILED');
    await rename(temp, path);
    if (digest(await readFile(path)) !== input.xlsxSha256) throw new Error('WORKBOOK_EXPORT_VERIFY_FAILED');
  } finally { await unlink(temp).catch(() => {}); }
  return { ok: true, path, sha256: input.xlsxSha256 };
}
