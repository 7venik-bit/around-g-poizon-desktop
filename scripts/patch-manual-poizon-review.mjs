import { readFile } from 'node:fs/promises';

const syncSource = await readFile(new URL('../services/poizon-screen-excel-sync.mjs', import.meta.url), 'utf8');
if (syncSource.includes("comparisonMode: 'POIZON_SCREEN_IS_SOURCE_OF_TRUTH'")) {
  console.log('Manual-review write block skipped: POIZON screen-authoritative compare/correct mode is active. Explicit read-only review workspace remains separate.');
  process.exit(0);
}

throw new Error('Legacy manual-review patch is only supported by retired non-screen-authoritative builds.');
