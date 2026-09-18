import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { JsonStore } from '../services/store.mjs';

const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
function section(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function saver(store, clear = async () => {}, windows = new Map()) {
  return runInNewContext(section(main, 'async function saveNaverAccount(', 'function observeNaverLoginSession(')
    + '\nsaveNaverAccount', {
    store, encrypted: password => 'encrypted:' + password,
    naverAccountCredentials: () => ({ code: store.snapshot().settings.naverPasswordEncrypted ? '' : 'NAVER_CREDENTIALS_REQUIRED' }),
    clearDomesticLogin: clear, domesticLoginWindows: windows,
    publicConfig: () => ({ naverLoginId: store.snapshot().settings.naverLoginId, hasNaverPassword: true }),
  });
}

test('Naver save survives reload and preserves other account/ledger settings', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'naver-save-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = new JsonStore(folder);
  await store.load();
  await store.setSettings({ poizonLoginId: 'poizon-fixture', nikeLoginId: 'nike-fixture', ledgerWebhookUrl: 'https://example.test' });
  let cleared = 0;
  const result = await saver(store, async id => { assert.equal(id, 'naver'); cleared++; })({
    naverLoginId: ' naver-fixture ', naverPassword: 'fixture-password', poizonLoginId: '',
  });
  const restored = new JsonStore(folder);
  await restored.load();
  assert.deepEqual(restored.snapshot().settings, {
    poizonLoginId: 'poizon-fixture', nikeLoginId: 'nike-fixture', ledgerWebhookUrl: 'https://example.test',
    naverLoginId: 'naver-fixture', naverPasswordEncrypted: 'encrypted:fixture-password',
  });
  assert.equal(cleared, 1);
  assert.doesNotMatch(JSON.stringify(result), /fixture-password|encrypted:/);
  await saver(store, async () => { throw Error('unchanged account must keep its session'); })({ naverLoginId: 'naver-fixture', naverPassword: '' });
  assert.equal(store.snapshot().settings.naverPasswordEncrypted, 'encrypted:fixture-password');
});

test('failed Naver disk save cannot replace the active account or appear saved until restart', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'naver-save-failure-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = new JsonStore(folder);
  await store.load();
  await store.setSettings({ naverLoginId: 'previous', naverPasswordEncrypted: 'encrypted:previous', ledgerWebhookUrl:'https://example.test' });
  await mkdir(`${store.path}.tmp`);
  let cleared = 0;
  const save = saver(store, async () => { cleared++; });
  await assert.rejects(save({ naverLoginId:'replacement', naverPassword:'replacement-password' }));
  assert.equal(store.snapshot().settings.naverLoginId, 'previous');
  assert.equal(store.snapshot().settings.naverPasswordEncrypted, 'encrypted:previous');
  assert.equal(cleared, 0);
  await rm(`${store.path}.tmp`, { recursive:true });
  await store.setSettings({ unrelated:'saved later' });
  const reopened = new JsonStore(folder);
  await reopened.load();
  assert.equal(reopened.snapshot().settings.naverLoginId, 'previous');
  await save({ naverLoginId:'replacement', naverPassword:'replacement-password' });
  assert.equal(cleared, 1);
  const restarted = new JsonStore(folder);
  await restarted.load();
  assert.equal(restarted.snapshot().settings.naverLoginId, 'replacement');
  assert.equal(restarted.snapshot().settings.ledgerWebhookUrl, 'https://example.test');
});

test('incomplete credentials never save or clear a working session', async () => {
  let writes = 0, clears = 0;
  const save = saver({ snapshot: () => ({ settings: { naverLoginId: 'old', naverPasswordEncrypted: 'encrypted:old' } }),
    setSettingsCommitted: async () => { writes++; } }, async () => { clears++; });
  await assert.rejects(save({ naverPassword: 'fixture' }), /NAVER_LOGIN_ID_REQUIRED/);
  await assert.rejects(save({ naverLoginId: 'new' }), /NAVER_PASSWORD_REQUIRED_ON_ACCOUNT_CHANGE/);
  assert.equal(writes, 0);
  assert.equal(clears, 0);
});

test('an explicitly replaced password resets the previous attempt but an unchanged account does not', async () => {
  let closed = 0;
  const settings = { naverLoginId: 'fixture', naverPasswordEncrypted: 'encrypted:old' };
  const store = { snapshot: () => ({ settings }), setSettingsCommitted: async next => Object.assign(settings, next) };
  const windows = new Map([['naver', { isDestroyed: () => false, close: () => { closed++; } }]]);
  const save = saver(store, async () => { assert.fail('same account must keep its valid session'); }, windows);
  await save({ naverLoginId: 'fixture', naverPassword: '' });
  assert.equal(closed, 0);
  await save({ naverLoginId: 'fixture', naverPassword: 'new-fixture' });
  assert.equal(closed, 1);
  assert.equal(settings.naverPasswordEncrypted, 'encrypted:new-fixture');
});

function rendererSaver(api, refresh = async () => {}) {
  const elements = {
    '#naver-login-id': { value: 'fixture-id' }, '#naver-password': { value: 'fixture-password' },
    '#naver-account-status': { className: '', textContent: '' },
  };
  const save = runInNewContext(section(renderer, 'async function saveNaverAccountAndLogin(', 'function domesticLoginStateLabel(')
    + '\nsaveNaverAccountAndLogin', { $: selector => elements[selector], window: { aroundG: api }, renderDomesticLoginStatuses: refresh });
  return { save, elements, button: { disabled: false, textContent: '저장하고 로그인' } };
}

test('save-and-login waits for durable save, prevents double clicks and clears the input only on success', async () => {
  const calls = [];
  let completeSave;
  const h = rendererSaver({
    saveNaverAccount: async input => {
      calls.push('save'); assert.equal(input.naverPassword, 'fixture-password');
      await new Promise(resolve => { completeSave = resolve; });
      return { naverLoginId: 'fixture-id', hasNaverPassword: true };
    },
    openDomesticLogin: async source => { assert.equal(source, 'naver'); calls.push('login'); return { ok: true, automatic: { ok: true } }; },
  }, async () => { calls.push('refresh'); });
  const pending = h.save(h.button);
  await h.save(h.button);
  assert.deepEqual(calls, ['save']);
  assert.equal(h.elements['#naver-password'].value, 'fixture-password');
  completeSave(); await pending;
  assert.deepEqual(calls, ['save', 'login', 'refresh']);
  assert.equal(h.elements['#naver-password'].value, '');
  assert.equal(h.button.disabled, false);
  assert.match(h.elements['#naver-account-status'].textContent, /계정 저장·로그인 확인 완료/);
});

test('a failed save never opens login, clears the input or displays private error details', async () => {
  const h = rendererSaver({
    saveNaverAccount: async () => { throw Error('disk failure fixture-password'); },
    openDomesticLogin: async () => { assert.fail('must not log in after a failed save'); },
  });
  await h.save(h.button);
  assert.equal(h.elements['#naver-password'].value, 'fixture-password');
  assert.match(h.elements['#naver-account-status'].textContent, /저장하지 못했습니다/);
  assert.doesNotMatch(h.elements['#naver-account-status'].textContent, /fixture-password|disk failure/);
  assert.equal(h.button.disabled, false);
});

test('authenticated Naver login checks reuse the session without opening a login page', async () => {
  const open = runInNewContext(section(main, 'async function openDomesticLogin(', 'async function clearDomesticLogin(')
    + '\nopenDomesticLogin', {
    domesticLoginSource: () => ({ id: 'naver' }), hasUsableNaverLoginSession: async () => true,
    BrowserWindow: class { constructor() { assert.fail('existing login must not open a fresh page'); } },
  });
  const result = await open('naver');
  assert.equal(result.reused, true);
  assert.equal(result.automatic.ok, true);
});

test('a fresh Naver login establishes the home session before opening nid login', () => {
  const start = main.indexOf('async function openDomesticLogin(');
  const end = main.indexOf('async function clearDomesticLogin(', start);
  const block = main.slice(start, end);
  const home = block.indexOf('loginWindow.loadURL("https://www.naver.com/")');
  const login = block.indexOf('loginWindow.loadURL(source.url)', home);
  assert.ok(home >= 0 && login > home);
});

test('Naver session recognition rejects empty or expired authentication cookies', async () => {
  let cookies = [];
  const usable = runInNewContext(section(main, 'async function hasUsableNaverLoginSession()', 'function naverAccountCredentials()')
    + '\nhasUsableNaverLoginSession', {
    DOMESTIC_SEARCH_PARTITION: 'fixture', session: { fromPartition: () => ({ cookies: { get: async () => cookies } }) },
  });
  cookies = [{ name: 'NID_AUT', value: 'fixture' }, { name: 'NID_SES', value: '' }];
  assert.equal(await usable(), false);
  cookies[1] = { name: 'NID_SES', value: 'fixture', expirationDate: Date.now() / 1000 - 1 };
  assert.equal(await usable(), false);
  cookies[1] = { name: 'NID_SES', value: 'fixture' };
  assert.equal(await usable(), true);
});

test('manual login cookie changes persist and update the UI before the window closes', async () => {
  const cookies = new EventEmitter(), win = new EventEmitter(), events = [];
  let usable = false, writes = 0;
  cookies.flushStore = async () => { writes++; };
  win.webContents = { session: { cookies } };
  const observe = runInNewContext(section(main, 'function observeNaverLoginSession(', 'async function submitStoredNaverCredentials(')
    + '\nobserveNaverLoginSession', {
    hasUsableNaverLoginSession: async () => usable,
    mainWindow: { webContents: { send: (channel, payload) => events.push({ channel, payload }) } },
  });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  observe(win); await tick();
  const initialWrites = writes;
  cookies.emit('changed', {}, { name: 'unrelated', domain: '.naver.com' }); await tick();
  assert.equal(writes, initialWrites);
  usable = true;
  cookies.emit('changed', {}, { name: 'NID_SES', domain: '.naver.com' }); await tick();
  assert.equal(events.at(-1).payload.hasSession, true);
  assert.equal(events.at(-1).channel, 'domestic-login:changed');
  assert.ok(writes > initialWrites);
  win.emit('closed'); await tick();
  assert.equal(cookies.listenerCount('changed'), 0);
});

test('native keep-login selection is only requested for an unchecked labelled checkbox', t => {
  const dom = new JSDOM('<input id="id"><input id="pw" type="password"><button id="log.login">로그인</button>'
    + '<input id="keep" type="checkbox"><label for="keep">로그인 상태 유지</label>');
  t.after(() => dom.window.close());
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 30 });
  const block = section(main, 'async function submitStoredNaverCredentials(', 'function domesticLoginSourceIdsForSearch(');
  const injected = block.slice(block.indexOf('executeJavaScript(`') + 'executeJavaScript(`'.length, block.indexOf('`, true).catch'));
  const script = runInNewContext('`' + injected + '`');
  const fields = () => runInNewContext(script, { document: dom.window.document, getComputedStyle: dom.window.getComputedStyle });
  assert.ok(fields().keepLogin);
  dom.window.document.querySelector('#keep').checked = true;
  assert.equal(fields().keepLogin, null);
  dom.window.document.querySelector('label').remove();
  assert.equal(fields().keepLogin, null);
});

test('login UI distinguishes missing credentials, saved credentials and a usable session', () => {
  const label = runInNewContext(section(renderer, 'function domesticLoginStateLabel(', 'async function renderDomesticLoginStatuses()') + '\ndomesticLoginStateLabel');
  assert.equal(label({ id: 'naver', hasSession: false, credentialCode: 'NAVER_CREDENTIALS_REQUIRED' }), '계정 저장 필요');
  assert.equal(label({ id: 'naver', hasSession: false, credentialCode: '' }), '자동 로그인 준비됨');
  assert.equal(label({ id: 'naver', hasSession: true, credentialCode: 'NAVER_CREDENTIALS_REQUIRED' }), '로그인 유지 중');
});
