import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { applyPoizonScreenSalesToWorkbook } from './poizon-screen-excel-sync.mjs';

const safeStamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '_');

export async function syncPoizonPageCheckpoint({
  filePath,
  products = [],
  pageNum = 0,
  backupPath = '',
  fs = { readFile, writeFile, copyFile },
  applyWorkbook = applyPoizonScreenSalesToWorkbook,
} = {}) {
  const path = String(filePath || '').trim();
  if (!path || !/\.xlsx$/i.test(path)) {
    return { ok: false, code: 'PAGE_CHECKPOINT_PATH_INVALID', message: '페이지 검증에 사용할 Excel 경로가 올바르지 않습니다.' };
  }
  if (!Array.isArray(products)) {
    return { ok: false, code: 'PAGE_CHECKPOINT_PRODUCTS_INVALID', message: `POIZON ${pageNum || '?'}페이지 상품 목록이 올바르지 않습니다.` };
  }
  if (!products.length) {
    const evidence = products.pageEvidence;
    const safeSkip = evidence?.verified === true
      && Number(evidence.sourceProducts || 0) > 0
      && Number(evidence.skippedSkuScope || 0) === Number(evidence.sourceProducts || 0);
    if (!safeSkip) {
      return { ok: false, code: 'PAGE_CHECKPOINT_PRODUCTS_EMPTY', message: `POIZON ${pageNum || '?'}페이지 상품이 없어 Excel 체크포인트를 진행하지 않습니다.` };
    }
    return {
      ok: true,
      code: 'PAGE_CHECKPOINT_SKU_SCOPE_SKIPPED',
      pageNum: Number(pageNum || 0),
      changed: false,
      changedRows: 0,
      changedCells: 0,
      addedRows: 0,
      addedProducts: 0,
      verifiedCells: 0,
      skippedSkuScope: Number(evidence.skippedSkuScope || 0),
      changes: [],
      reverified: true,
      backupPath: String(backupPath || ''),
    };
  }

  try {
    const original = await fs.readFile(path);
    const applied = applyWorkbook(original, products);
    if (!applied?.ok || applied.reverified !== true) {
      return { ok: false, code: applied?.code || 'PAGE_CHECKPOINT_APPLY_FAILED', message: applied?.message || 'POIZON 페이지 값을 Excel에 적용할 수 없습니다.' };
    }

    let finalBackupPath = String(backupPath || '');
    if (applied.changed) {
      if (!finalBackupPath) {
        finalBackupPath = `${path}.before-poizon-page-sync-${safeStamp()}.bak`;
        await fs.copyFile(path, finalBackupPath);
      }
      await fs.writeFile(path, applied.buffer);
    }

    // 저장된 디스크 파일을 즉시 다시 읽고 같은 POIZON 페이지를 재적용한다.
    // 재적용에서 변경이 한 건이라도 발생하면 저장 결과가 확정되지 않은 것이므로 다음 페이지를 막는다.
    const reread = await fs.readFile(path);
    const verified = applyWorkbook(reread, products);
    if (!verified?.ok || verified.reverified !== true || verified.changed) {
      return {
        ok: false,
        code: 'PAGE_CHECKPOINT_REREAD_MISMATCH',
        message: `POIZON ${pageNum || '?'}페이지 Excel 저장 후 재검증에 실패했습니다. 다음 페이지로 이동하지 않습니다.`,
        verification: verified,
        backupPath: finalBackupPath,
      };
    }

    return {
      ok: true,
      pageNum: Number(pageNum || 0),
      changed: Boolean(applied.changed),
      changedRows: Number(applied.changedRows || 0),
      changedCells: Number(applied.changedCells || 0),
      addedRows: Number(applied.addedRows || 0),
      addedProducts: Number(applied.addedProducts || 0),
      verifiedCells: Number(applied.verifiedCells || 0),
      skippedSkuScope: Number(products.pageEvidence?.skippedSkuScope || 0),
      changes: Array.isArray(applied.changes) ? applied.changes : [],
      reverified: true,
      backupPath: finalBackupPath,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'PAGE_CHECKPOINT_IO_FAILED',
      message: error instanceof Error ? error.message : String(error),
      backupPath: String(backupPath || ''),
    };
  }
}
