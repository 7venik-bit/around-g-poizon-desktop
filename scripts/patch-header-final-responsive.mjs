import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, content) => writeFile(new URL(path, root), content, 'utf8');

let css = await read('src/style.css');
const marker = '/* HEADER_FINAL_RESPONSIVE_V1 */';
if (!css.includes(marker)) {
  css += `\n${marker}\n/* Final header layout: one line, compact labels, no duplicated status copy. */\nbody .shell>header{\n  display:flex!important;\n  align-items:center!important;\n  gap:clamp(6px,.8vw,12px)!important;\n  min-height:74px!important;\n  height:auto!important;\n  padding:10px clamp(12px,1.5vw,22px)!important;\n  grid-template-columns:none!important;\n  grid-template-areas:none!important;\n  flex-wrap:nowrap!important\n}\n.workspace-title{flex:0 0 auto!important;min-width:auto!important}\n.header-status-stack{\n  display:flex!important;\n  align-items:center!important;\n  gap:clamp(4px,.55vw,8px)!important;\n  flex:0 1 auto!important;\n  min-width:0!important;\n  width:auto!important;\n  flex-wrap:nowrap!important;\n  justify-content:flex-start!important\n}\n.header-status-stack .official-domain-audit,\n.header-status-stack .weekly-site-health,\n.header-status-stack .startup-recovery,\n.header-status-stack .brand-export-folder-setting{\n  flex:0 0 auto!important;\n  width:auto!important;\n  min-width:0!important;\n  height:32px!important;\n  min-height:32px!important;\n  padding:0!important;\n  margin:0!important\n}\n.header-status-stack .official-domain-audit>div,\n.header-status-stack .weekly-site-health>div,\n.header-status-stack .startup-recovery-heading>strong,\n.header-status-stack .startup-recovery-heading-actions>span,\n.header-status-stack .startup-recovery p,\n.header-status-stack .startup-recovery-progress,\n.header-status-stack .brand-export-folder-path{display:none!important}\n.header-status-stack .startup-recovery-heading,\n.header-status-stack .startup-recovery-heading-actions{display:contents!important}\n.header-status-stack button{\n  width:auto!important;\n  min-width:0!important;\n  max-width:none!important;\n  height:32px!important;\n  min-height:32px!important;\n  padding:0 clamp(8px,.7vw,12px)!important;\n  border-radius:8px!important;\n  font-size:0!important;\n  line-height:1!important;\n  white-space:nowrap!important;\n  display:inline-flex!important;\n  align-items:center!important;\n  justify-content:center!important\n}\n#official-domain-audit-toggle::after{content:'공식몰';font-size:clamp(9px,.68vw,11px)!important}\n#weekly-site-health-run::after{content:'서버';font-size:clamp(9px,.68vw,11px)!important}\n#startup-recovery-run::after{content:'POIZON';font-size:clamp(9px,.68vw,11px)!important}\n#brand-export-folder-select::after{content:'저장';font-size:clamp(9px,.68vw,11px)!important}\n.header-actions{\n  margin-left:auto!important;\n  display:flex!important;\n  align-items:center!important;\n  justify-content:flex-end!important;\n  gap:clamp(4px,.55vw,8px)!important;\n  min-width:0!important;\n  width:auto!important;\n  flex:0 1 auto!important;\n  flex-wrap:nowrap!important\n}\n.header-actions>button,\n.header-actions>.update-anchor>.update-button,\n.header-actions>.download-sync-anchor>button{\n  width:auto!important;\n  min-width:0!important;\n  max-width:none!important;\n  height:32px!important;\n  min-height:32px!important;\n  padding:0 clamp(8px,.8vw,13px)!important;\n  border-radius:8px!important;\n  font-size:clamp(9px,.66vw,11px)!important;\n  line-height:1!important;\n  white-space:nowrap!important\n}\n.update-anchor,.download-sync-anchor{position:relative!important;display:flex!important;align-items:center!important;flex:0 0 auto!important}\n#app-version-state{display:none!important}\n.update-inline{\n  position:absolute!important;\n  top:calc(100% + 8px)!important;\n  right:0!important;\n  left:auto!important;\n  width:min(300px,80vw)!important;\n  z-index:30!important;\n  margin:0!important\n}\n.update-inline[hidden]{display:none!important}\n.header-sync-progress{position:absolute!important;top:calc(100% + 8px)!important;right:0!important;width:210px!important;z-index:30!important}\n@media(max-width:1100px){\n  body .shell>header{gap:5px!important;padding-inline:10px!important}\n  .header-status-stack{gap:3px!important}\n  .header-actions{gap:3px!important}\n  .header-status-stack button{padding-inline:7px!important}\n  .header-actions>button,.header-actions>.update-anchor>.update-button,.header-actions>.download-sync-anchor>button{padding-inline:8px!important}\n}\n@media(max-width:860px){\n  body .shell>header{overflow-x:auto!important;scrollbar-width:thin!important}\n  .header-status-stack,.header-actions{flex-shrink:0!important}\n}\n`;
}
css = css
  .replace("content:'공식몰';", "content:'공식몰 점검';")
  .replace("content:'서버';", "content:'서버 점검';")
  .replace("content:'POIZON';", "content:'POIZON 확인';")
  .replace("content:'저장';", "content:'저장 폴더';");
await save('src/style.css', css);

const finalCss = await read('src/style.css');
for (const required of [
  marker,
  "#official-domain-audit-toggle::after{content:'공식몰 점검'",
  "#weekly-site-health-run::after{content:'서버 점검'",
  "#startup-recovery-run::after{content:'POIZON 확인'",
  "#brand-export-folder-select::after{content:'저장 폴더'",
  '#app-version-state{display:none!important}',
  'flex-wrap:nowrap!important',
  'font-size:clamp(9px,.66vw,11px)!important'
]) {
  if (!finalCss.includes(required)) throw new Error(`final header verification failed: ${required}`);
}
console.log('Final responsive header verified.');
