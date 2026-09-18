// A CJS entry guarantees the Electron main process owns and awaits the ESM
// bootstrap. Only the diagnostic script is normalized; app files stay intact.
const {app}=require('electron');
const {mkdirSync,readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const out=process.env.AROUNDG_LIVE_OUTPUT;
mkdirSync(out,{recursive:true});
let ended=false;
function fail(error){
  if(ended)return;ended=true;
  const message=String(error?.stack||error);
  writeFileSync(join(out,'bootstrap-error.txt'),message);
  console.error('LIVE_BOOTSTRAP_FAILED',message);app.exit(2);
}
process.on('uncaughtException',fail);
process.on('unhandledRejection',fail);
writeFileSync(join(out,'electron-started.json'),JSON.stringify({pid:process.pid,electron:process.versions.electron,at:new Date().toISOString()}));
let source=readFileSync(join(__dirname,'live-retailer-program-audit.mjs'),'utf8');
// The embedded DOM expression must not lose slash escapes in a JS template.
source=source.split('\n').map(line=>line.includes('const relevant=links.filter(')
  ? "          const relevant=links.filter(a=>['window-products','/products/','/product/','.html','itemView'].some(path=>a.href.includes(path)));"
  : line).join('\n');
source=source.replace('let finishing=false, ui=null, sequence=0;','let finishing=false, ui=null, uiReady=false, sequence=0;')
  .replace('if(ready)break;','if(ready){uiReady=true;break;}')
  .replace("if(!ui)throw new Error('APP_WINDOW_NOT_READY');","if(!ui || !uiReady)throw new Error('APP_WINDOW_NOT_READY');");
const runtime=join(__dirname,'.live-retailer-runtime.mjs');
writeFileSync(runtime,source);
import(pathToFileURL(runtime).href).catch(fail);
