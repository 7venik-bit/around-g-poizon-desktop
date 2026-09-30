// Await the real GUI child and require saved evidence; shell exit is not proof.
const {spawn,spawnSync}=require('node:child_process');
const {mkdirSync,createWriteStream,readFileSync,writeFileSync,existsSync}=require('node:fs');
const {join}=require('node:path');
const out=process.env.AROUNDG_LIVE_OUTPUT;
if(!out)throw new Error('AROUNDG_LIVE_OUTPUT is required');
mkdirSync(out,{recursive:true});
const startedAt=new Date().toISOString();
writeFileSync(join(out,'launcher.json'),JSON.stringify({startedAt,scenario:process.env.AROUNDG_LIVE_CASE,platform:process.platform,stage:'preparing'}));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let appDir;
try {
  // Normalize only diagnostic input, not application source. Windows checkout
  // must not break this LF-delimited native ESM startup transformation.
  let source=readFileSync(join(__dirname,'live-retailer-program-audit.mjs'),'utf8').replace(/\r\n?/g,'\n');
  source=source.split('\n').map(line=>{
    if(line.includes('const relevant=links.filter('))return "          const relevant=links.filter(a=>['window-products','/products/','/product/','.html','itemView'].some(path=>a.href.includes(path)));";
    if(line.includes('report.openResult=await ui.webContents.executeJavaScript('))return line.replace('report.openResult=await ','void ').replace('.catch(error=>({error:error.message}));','.then(value=>{report.openResult=value;save();}).catch(error=>{report.openResult={error:error.message};save();});');
    return line;
  }).join('\n');
  source=source.replace('let finishing=false, ui=null, sequence=0;','let finishing=false, ui=null, uiReady=false, sequence=0;')
    .replace('if(ready)break;','if(ready){uiReady=true;break;}')
    .replace("if(!ui)throw new Error('APP_WINDOW_NOT_READY');","if(!ui || !uiReady)throw new Error('APP_WINDOW_NOT_READY');");
  const boundary="await import('../bootstrap.mjs');\nawait app.whenReady();\ntry {";
  if(!source.includes(boundary))throw new Error('Audit ESM startup boundary missing');
  source=source.replace(boundary,"await import('../bootstrap.mjs');\napp.whenReady().then(async () => {\ntry {");
  source+="\n}).catch(error => { report.errors.push(String(error?.stack||error)); report.outcome='audit_execution_error'; void finish(2); });\n";
  const runtime=join(__dirname,'.live-retailer-runtime.mjs');
  writeFileSync(runtime,source);
  const checked=spawnSync(process.execPath,['--check',runtime],{encoding:'utf8'});
  if(checked.status!==0)throw new Error('Diagnostic syntax: '+checked.stderr);
  const entry=`import {app} from 'electron';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const out=process.env.AROUNDG_LIVE_OUTPUT;mkdirSync(out,{recursive:true});
let failed=false;
const fail=error=>{if(failed)return;failed=true;const message=String(error?.stack||error);writeFileSync(join(out,'bootstrap-error.txt'),message);console.error('LIVE_BOOTSTRAP_FAILED',message);app.exit(2);};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
writeFileSync(join(out,'electron-started.json'),JSON.stringify({pid:process.pid,electron:process.versions.electron,at:new Date().toISOString()}));
try { await import('./.live-retailer-runtime.mjs'); } catch(error) { fail(error); }
`;
  writeFileSync(join(__dirname,'.live-retailer-entry.mjs'),entry);
  appDir=join(__dirname,'..','.live-retailer-app');mkdirSync(appDir,{recursive:true});
  writeFileSync(join(appDir,'package.json'),JSON.stringify({name:'around-g-live-retailer-audit',version:'2.10.744-audit',type:'module',main:'../scripts/.live-retailer-entry.mjs'}));
} catch(error) {
  writeFileSync(join(out,'launcher-error.txt'),String(error?.stack||error));
  console.error('LIVE_PREPARATION_FAILED',error);process.exit(2);
}
const log=createWriteStream(join(out,'launcher.log'));
const child=spawn(require('electron'),[appDir],{env,stdio:['ignore','pipe','pipe'],windowsHide:false});
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{log.write(data);process.stdout.write(data);});
let timedOut=false;
const timer=setTimeout(()=>{timedOut=true;if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'inherit'});else child.kill('SIGKILL');},480000);
child.on('error',error=>{clearTimeout(timer);log.end(String(error));writeFileSync(join(out,'launcher-error.txt'),String(error));process.exitCode=2;});
child.on('close',(code,signal)=>{
  clearTimeout(timer);log.end();let report=null;
  try {report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));}catch{}
  const completed=Boolean(report?.finishedAt && report?.scenario===env.AROUNDG_LIVE_CASE);
  const screenshot=existsSync(join(out,'application-result.png'));
  const passed=!timedOut && code===0 && completed && screenshot && report?.outcome==='live_product_price_observed';
  const summary={startedAt,finishedAt:new Date().toISOString(),scenario:env.AROUNDG_LIVE_CASE,exitCode:code,signal,timedOut,completed,screenshot,outcome:report?.outcome||'NO_EXECUTION_REPORT',passed};
  writeFileSync(join(out,'launcher.json'),JSON.stringify(summary,null,2));
  console.log('LIVE_EXECUTION_EVIDENCE '+JSON.stringify(summary));process.exitCode=passed?0:2;
});
