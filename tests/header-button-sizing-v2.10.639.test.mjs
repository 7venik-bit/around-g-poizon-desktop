import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('header status buttons keep balanced fixed height and content-based widths', () => {
  for (const required of [
    '/* HEADER_BUTTON_SIZING_V1 */',
    '#official-domain-audit-toggle{min-width:78px!important}',
    '#weekly-site-health-run{min-width:70px!important}',
    '#startup-recovery-run{min-width:76px!important}',
    '.header-status-stack .brand-export-folder-setting::before{min-width:72px!important}',
    'height:34px!important',
    'align-items:center!important',
    'justify-content:center!important',
  ]) assert.ok(css.includes(required), required);
});

test('postinstall reapplies header sizing after other header patches', () => {
  const postinstall = packageJson.scripts.postinstall;
  const simple = postinstall.indexOf('patch-header-simple-actions-v2.mjs');
  const sizing = postinstall.indexOf('patch-header-button-sizing.mjs');
  assert.ok(simple >= 0 && sizing > simple);
});
