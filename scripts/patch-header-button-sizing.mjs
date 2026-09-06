import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, content) => writeFile(new URL(path, root), content, 'utf8');

let css = await read('src/style.css');
const marker = '/* HEADER_BUTTON_SIZING_V1 */';
if (!css.includes(marker)) {
  css += `\n${marker}\n.header-status-stack{align-items:center!important;gap:8px!important}\n.header-status-stack .official-domain-audit,\n.header-status-stack .weekly-site-health,\n.header-status-stack .startup-recovery,\n.header-status-stack .brand-export-folder-setting{\n  flex:0 0 auto!important;\n  width:auto!important;\n  min-width:0!important;\n  height:34px!important;\n  min-height:34px!important;\n  padding:0!important;\n  border:0!important;\n  background:transparent!important;\n  overflow:visible!important\n}\n.header-status-stack button,\n.header-status-stack .brand-export-folder-setting::before{\n  display:inline-flex!important;\n  align-items:center!important;\n  justify-content:center!important;\n  height:34px!important;\n  min-height:34px!important;\n  padding:0 12px!important;\n  border-radius:8px!important;\n  font-size:10px!important;\n  font-weight:700!important;\n  line-height:1!important;\n  letter-spacing:0!important;\n  white-space:nowrap!important\n}\n#official-domain-audit-toggle{min-width:78px!important}\n#weekly-site-health-run{min-width:70px!important}\n#startup-recovery-run{min-width:76px!important}\n.header-status-stack .brand-export-folder-setting::before{min-width:72px!important}\n.header-status-stack .startup-recovery-heading,\n.header-status-stack .startup-recovery-heading-actions{height:34px!important;align-items:center!important}\n.header-status-stack .startup-recovery-heading-actions{gap:4px!important}\n#startup-recovery-percent{font-size:10px!important;line-height:1!important;min-width:24px!important;text-align:center!important}\nbody .shell>header{align-items:center!important}\n.workspace-title,.header-actions{align-self:center!important}\n.header-actions>button,\n.header-actions>.update-anchor>.update-button,\n.header-actions>.download-sync-anchor>button{height:36px!important;min-height:36px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important}\n@media(max-width:1500px){.header-status-stack{justify-content:flex-start!important}}\n`;
}
await save('src/style.css', css);

const finalCss = await read('src/style.css');
for (const required of [
  '/* HEADER_BUTTON_SIZING_V1 */',
  '#official-domain-audit-toggle{min-width:78px!important}',
  '#weekly-site-health-run{min-width:70px!important}',
  '#startup-recovery-run{min-width:76px!important}',
  '.header-status-stack .brand-export-folder-setting::before{min-width:72px!important}',
]) {
  if (!finalCss.includes(required)) throw new Error(`header sizing verification failed: ${required}`);
}
console.log('Header button sizing verified.');
