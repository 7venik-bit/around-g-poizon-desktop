import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const profile = mkdtempSync(join(tmpdir(), 'aroundg-stock-test-'));
const env = {...process.env, AROUNDG_STOCK_TEST_PROFILE:profile};
delete env.ELECTRON_RUN_AS_NODE;
// Every request is fulfilled by the offline session protocol handler. Linux
// CI runs as root; the production application keeps its sandbox enabled.
const args = process.platform === 'linux' ? ['--no-sandbox', '--headless', '--ozone-platform=headless'] : [];
args.push(fileURLToPath(new URL('../tests/fixtures/domestic-live-frame.cjs', import.meta.url)));
const child = spawn(require('electron'), args, {env, stdio:'inherit'});
const watchdog = setTimeout(() => child.kill(), 55_000);
child.on('error', error => {console.error(error); process.exitCode=1;});
child.on('close', code => {
  clearTimeout(watchdog);
  rmSync(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200});
  process.exitCode = code ?? 1;
});
