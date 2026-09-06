import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const RETIRED_SYNC_CSS = `/* RETIRED_HEADER_DOWNLOAD_SYNC */
/* Preserve legacy DOM lookups without exposing a redundant action. */
body .shell > header .header-actions > .download-sync-anchor,
body .shell > header #import-button,
body .shell > header #excel-sync-progress {
  display: none !important;
}
`;

function setAttribute(tag, name, value = '') {
  const existing = new RegExp('\\s' + name + '(?=\\s|=|/?>)(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s>]+))?', 'gi');
  return tag.replace(existing, '').replace(/>$/, ` ${name}="${value}">`);
}

export function retireDownloadSyncMarkup(html) {
  let anchors = 0, buttons = 0, progress = 0;
  const result = html.replace(/<[a-z][^>]*>/gi, (tag) => {
    const className = tag.match(/\sclass\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    const id = tag.match(/\sid\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    if (className.split(/\s+/).includes('download-sync-anchor')) {
      anchors++;
      return setAttribute(setAttribute(setAttribute(tag, 'hidden'), 'inert'), 'aria-hidden', 'true');
    }
    if (id === 'import-button') {
      buttons++;
      return setAttribute(setAttribute(setAttribute(tag, 'hidden'), 'disabled'), 'tabindex', '-1');
    }
    if (id === 'excel-sync-progress') {
      progress++;
      return setAttribute(setAttribute(tag, 'hidden'), 'aria-hidden', 'true');
    }
    return tag;
  });
  if (anchors !== 1 || buttons !== 1 || progress !== 1) {
    throw new Error(`Unexpected download sync markup: anchors=${anchors}, buttons=${buttons}, progress=${progress}`);
  }
  if (result.includes('id="retired-download-sync-styles"')) return result;
  if (!result.includes('</head>')) throw new Error('Header stylesheet insertion point missing');
  return result.replace('</head>', '  <link id="retired-download-sync-styles" rel="stylesheet" href="./retired-download-sync.css">\n</head>');
}

export async function applyRetiredDownloadSync(root = new URL('../', import.meta.url)) {
  const htmlPath = new URL('src/index.html', root);
  const before = await readFile(htmlPath, 'utf8');
  const after = retireDownloadSyncMarkup(before);
  if (before !== after) await writeFile(htmlPath, after, 'utf8');
  await writeFile(new URL('src/retired-download-sync.css', root), RETIRED_SYNC_CSS, 'utf8');
  console.log('Header download synchronization retired; Excel loading and explicit POIZON review unchanged.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await applyRetiredDownloadSync();
}
