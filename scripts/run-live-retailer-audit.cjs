// Await the GUI child process: a successful shell launch is NOT a test result.
const {spawn} = require('node:child_process');
const {mkdirSync,createWriteStream,readFileSync,writeFileSync,existsSync} = require('node:fs');
const {join,resolve} = require('node:path');
const out=process.env.AROUNDG_LIVE_OUTPUT;
if(!out)throw new Error('AROUNDG_LIVE_OUTPUT is required');
mkdirSync(out,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const startedAt=new Date().toISOString();
writeFileSync(join(out,'launcher.json'),JSON.stringify({startedAt,scenario:env.AROUNDG_LIVE_CASE,platform:process.platform}));
const log=createWriteStream(join(out,'launcher.log'));
const child=spawn(require('electron'),[resolve(__dirname,'live-retailer-audit-entry.cjs')],{env,stdio:['ignore','pipe','pipe'],windowsHide:false});
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{log.write(data);process.stdout.write(data);});
let timedOut=false;
const timer=setTimeout(()=>{
  timedOut=true;
  if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'inherit'});
  else child.kill('SIGKILL');
},480000);
child.on('error',error=>{
  clearTimeout(timer);log.end(String(error));
  writeFileSync(join(out,'launcher-error.txt'),String(error));process.exitCode=2;
});
child.on('close',(code,signal)=>{
  clearTimeout(timer);log.end();
  let report=null;
  try {report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));}catch{}
  const completed=Boolean(report?.finishedAt && report?.scenario===env.AROUNDG_LIVE_CASE);
  const screenshot=existsSync(join(out,'application-result.png'));
  const passed=!timedOut && code===0 && completed && screenshot && report?.outcome==='live_product_price_observed';
  const summary={startedAt,finishedAt:new Date().toISOString(),scenario:env.AROUNDG_LIVE_CASE,exitCode:code,signal,timedOut,completed,screenshot,outcome:report?.outcome||'NO_EXECUTION_REPORT',passed};
  writeFileSync(join(out,'launcher.json'),JSON.stringify(summary,null,2));
  console.log('LIVE_EXECUTION_EVIDENCE '+JSON.stringify(summary));
  process.exitCode=passed?0:2;
});
