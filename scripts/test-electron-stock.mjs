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
try {
  const shipping = ['domestic-shipping-ipc.cjs'];
  const stalled = ['domestic-shipping-ipc.cjs', '--stalled-details'];
  const fixtures = process.argv.includes('--stalled') ? [stalled]
    : process.argv.includes('--shipping') ? [shipping]
    : [['domestic-live-frame.cjs'], shipping, stalled];
  for (const [fixture, ...fixtureArgs] of fixtures) {
    const args = process.platform === 'linux' ? ['--no-sandbox', '--headless', '--ozone-platform=headless'] : [];
    args.push(fileURLToPath(new URL('../tests/fixtures/' + fixture, import.meta.url)));
    args.push(...fixtureArgs);
    const code = await new Promise((done, reject) => {
      const child = spawn(require('electron'), args, {env, stdio:'inherit'});
      const watchdog = setTimeout(() => child.kill(), fixture === 'domestic-shipping-ipc.cjs' ? 215_000 : 55_000);
      child.on('error', error => {clearTimeout(watchdog);reject(error);});
      child.on('close', code => {clearTimeout(watchdog);done(code);});
    });
    if (code !== 0) {console.error(`${fixture} exited with ${code}`);process.exitCode = code ?? 1;break;}
  }
} finally {
  rmSync(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200});
}
