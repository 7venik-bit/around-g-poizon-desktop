import { readFile, writeFile } from 'node:fs/promises';

export const layoutLink = '<link id="header-brand-layout-styles" rel="stylesheet" href="./header-brand-layout.css">';
export function installLayoutLink(html) {
  if (!html.includes('</head>')) throw new Error('Missing document head for header/brand layout');
  const clean = html.replace(/\s*<link\b[^>]*\bid=["']header-brand-layout-styles["'][^>]*>/g, '');
  return clean.replace(/\s*<\/head>/, `\n  ${layoutLink}\n</head>`);
}
const root = new URL('../', import.meta.url);
const path = new URL('src/index.html', root);
const html = await readFile(path, 'utf8');
const css = await readFile(new URL('src/header-brand-layout.css', root), 'utf8');
if (!css.includes('HEADER_BRAND_LAYOUT_V1')) throw new Error('Missing header/brand layout stylesheet');
const updated = installLayoutLink(html);
if (updated !== html) await writeFile(path, updated, 'utf8');
console.log('Header action gaps and brand title/count layout installed.');
