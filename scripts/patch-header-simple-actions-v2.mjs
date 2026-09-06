import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, content) => writeFile(new URL(path, root), content, 'utf8');

let css = await read('src/style.css');
const marker = '/* SIMPLE_HEADER_ACTIONS_V2 */';
if (!css.includes(marker)) {
  css += `\n${marker}\n/* Status header is action-first: one compact control per function. */\n.header-status-stack{display:flex!important;align-items:center!important;gap:7px!important;min-width:0!important;flex-wrap:wrap!important}\n.header-status-stack .official-domain-audit,\n.header-status-stack .weekly-site-health,\n.header-status-stack .startup-recovery,\n.header-status-stack .brand-export-folder-setting{\n  flex:0 0 auto!important;display:flex!important;align-items:center!important;justify-content:center!important;\n  min-width:0!important;width:auto!important;min-height:38px!important;height:auto!important;padding:0!important;\n  border:0!important;background:transparent!important;overflow:visible!important;white-space:normal!important\n}\n.header-status-stack .official-domain-audit>div,\n.header-status-stack .weekly-site-health>div,\n.header-status-stack .startup-recovery-heading>strong,\n.header-status-stack .startup-recovery-heading-actions>span,\n.header-status-stack .startup-recovery p,\n.header-status-stack .startup-recovery-progress,\n.header-status-stack .brand-export-folder-path{display:none!important}\n.header-status-stack .startup-recovery-heading,\n.header-status-stack .startup-recovery-heading-actions{display:contents!important}\n.header-status-stack button{\n  display:inline-flex!important;align-items:center!important;justify-content:center!important;\n  min-width:86px!important;max-width:none!important;height:38px!important;padding:0 12px!important;\n  overflow:visible!important;white-space:nowrap!important;text-overflow:clip!important;line-height:1!important;\n  font-size:0!important;font-weight:700!important;flex:0 0 auto!important\n}\n#official-domain-audit-toggle::after{content:'공식몰 점검';font-size:10px}\n#weekly-site-health-run::after{content:'서버 점검';font-size:10px}\n#startup-recovery-run::after{content:'POIZON 확인';font-size:10px}\n#brand-export-folder-select::after{content:'저장 폴더';font-size:10px}\n.header-status-stack .brand-export-folder-setting::before{display:none!important;content:none!important}\nbody .shell>header{grid-template-columns:auto minmax(0,1fr) auto!important;align-items:center!important}\n.header-actions{align-items:center!important;flex-wrap:wrap!important;min-width:0!important}\n@media(max-width:1500px){\n  body .shell>header{grid-template-columns:auto 1fr!important;grid-template-areas:'lamps status' 'actions actions'!important;row-gap:8px!important}\n  .workspace-title{grid-area:lamps!important}\n  .header-status-stack{grid-area:status!important}\n  .header-actions{grid-area:actions!important;width:100%!important;justify-content:flex-end!important}\n}\n@media(max-width:980px){\n  .header-status-stack{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;width:100%!important}\n  .header-status-stack>*,.header-status-stack button{width:100%!important}\n}\n@media(max-width:620px){.header-status-stack{grid-template-columns:1fr!important}}\n`;
}
await save('src/style.css', css);

const finalCss = await read('src/style.css');
for (const required of [
  marker,
  "#official-domain-audit-toggle::after{content:'공식몰 점검';font-size:10px}",
  "#weekly-site-health-run::after{content:'서버 점검';font-size:10px}",
  "#startup-recovery-run::after{content:'POIZON 확인';font-size:10px}",
  "#brand-export-folder-select::after{content:'저장 폴더';font-size:10px}",
  'font-size:0!important',
  '@media(max-width:1500px)',
  '.window-dots.sourcing i:nth-child(1){animation-delay:0s!important}',
  '.window-dots.sourcing i:nth-child(2){animation-delay:.18s!important}',
  '.window-dots.sourcing i:nth-child(3){animation-delay:.36s!important}'
]) {
  if (!finalCss.includes(required)) throw new Error(`header V2 verification failed: ${required}`);
}
console.log('Header V2 verified: compact action labels prevent clipping while traffic-light sequence remains unchanged.');
