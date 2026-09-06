import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, content) => writeFile(new URL(path, root), content, 'utf8');

let html = await read('src/index.html');
const replacements = [
  ['공식몰 전체 검증·연동 · 수동', '공식몰 점검'],
  ['전체 브랜드 공식몰 재검증·연동', '공식몰 점검'],
  ['연동 서버 정기점검 · 매주 수요일 밤 12시', '서버 점검'],
  ['기존 POIZON 작업 및 변경 사항 확인 · 수동', 'POIZON 확인'],
  ['지금 확인', '확인'],
  ['브랜드별 저장 폴더: ', '저장 폴더: '],
];
for (const [before, after] of replacements) html = html.replace(before, after);
await save('src/index.html', html);

let css = await read('src/style.css');
const marker = '/* SIMPLE_HEADER_TRAFFIC_V1 */';
if (!css.includes(marker)) {
  css += `\n${marker}\n/* Keep the existing 1→2→3 chase timing; only the lamp palette changes. */\n.window-dots i:nth-child(1){background:#ef4444!important;color:#ef4444}\n.window-dots i:nth-child(2){background:#facc15!important;color:#facc15}\n.window-dots i:nth-child(3){background:#22c55e!important;color:#22c55e}\n.window-dots.connected i:nth-child(3){box-shadow:0 0 9px #22c55e!important}\n.window-dots.disconnected i:nth-child(1){box-shadow:0 0 10px #ef4444!important}\n\n/* Compact status strip: titles and actions only; verbose operational copy stays in the DOM for logic/accessibility. */\n.header-status-stack{display:flex!important;align-items:center!important;gap:6px!important;min-width:0!important;flex-wrap:nowrap!important}\n.header-status-stack .official-domain-audit,\n.header-status-stack .weekly-site-health,\n.header-status-stack .startup-recovery,\n.header-status-stack .brand-export-folder-setting{\n  display:flex!important;align-items:center!important;justify-content:space-between!important;gap:7px!important;\n  min-height:38px!important;padding:6px 8px!important;border-radius:9px!important;white-space:nowrap!important;overflow:hidden!important\n}\n.header-status-stack .official-domain-audit>div,\n.header-status-stack .weekly-site-health>div{display:block!important;min-width:0!important}\n.header-status-stack .official-domain-audit span,\n.header-status-stack .weekly-site-health span,\n.header-status-stack .weekly-site-health small,\n.header-status-stack .startup-recovery p,\n.header-status-stack .startup-recovery-progress,\n.header-status-stack .brand-export-folder-path{display:none!important}\n.header-status-stack .startup-recovery-heading{display:flex!important;align-items:center!important;gap:6px!important}\n.header-status-stack .startup-recovery-heading-actions{gap:5px!important}\n.header-status-stack .official-domain-audit strong,\n.header-status-stack .weekly-site-health strong,\n.header-status-stack .startup-recovery-heading strong{font-size:10px!important;line-height:1!important}\n.header-status-stack button{padding:5px 7px!important;font-size:9px!important;line-height:1.1!important}\n.header-status-stack .brand-export-folder-setting::before{content:'저장 폴더';font-size:10px;font-weight:700;color:#17365d}\nbody .shell>header{grid-template-columns:auto minmax(0,1fr) auto!important}\n@media(max-width:1180px){.header-status-stack{flex-wrap:wrap!important}}\n`;
}
await save('src/style.css', css);

// Verification: the sequence timings remain exactly ordered and colors are traffic-light red/yellow/green.
const finalCss = await read('src/style.css');
for (const required of [
  '.window-dots.sourcing i:nth-child(1){animation-delay:0s!important}',
  '.window-dots.sourcing i:nth-child(2){animation-delay:.18s!important}',
  '.window-dots.sourcing i:nth-child(3){animation-delay:.36s!important}',
  '.window-dots i:nth-child(1){background:#ef4444!important;color:#ef4444}',
  '.window-dots i:nth-child(2){background:#facc15!important;color:#facc15}',
  '.window-dots i:nth-child(3){background:#22c55e!important;color:#22c55e}',
  '.header-status-stack .startup-recovery-progress,',
]) {
  if (!finalCss.includes(required)) throw new Error(`simple header verification failed: ${required}`);
}
const finalHtml = await read('src/index.html');
for (const label of ['공식몰 점검', '서버 점검', 'POIZON 확인']) {
  if (!finalHtml.includes(label)) throw new Error(`simple header label missing: ${label}`);
}
console.log('Simple header verified: traffic-light palette applied and existing sequence timing preserved.');
