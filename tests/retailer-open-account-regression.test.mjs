import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { queryDomesticProducts, sanitizeDomesticProductCode, sanitizeDomesticQuery } from '../relay/domestic-search.mjs';

const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

const product = { query: 'TVJDW25612', articleNumber: 'TVJDW25612', brand: '코오롱스포츠',
  title: '코오롱스포츠 여성 쿠치 윈드스토퍼 중기장 미드 다운 TVJDW25612OAT' };
const emptyPage = '<script id="__NEXT_DATA__">{"props":{"pageProps":{"dehydratedState":{"queries":[]}}}}</script>';

test('Kolon official and retailer selections collect the same merchant only once', async () => {
  const requests = [];
  const result = await queryDomesticProducts({ ...product, enabledSourceGroups: ['official', 'retailers'],
    fetchImpl: async url => { requests.push(url); return new Response(emptyPage); } });
  assert.deepEqual(result.sources.map(s => s.store), ['브랜드 공식몰']);
  assert.equal(requests.length, 0, 'duplicate Kolon HTTP collection must not run');
});

for (const status of ['verified', 'search_unsupported']) {
  for (const host of ['kolonmall.com', 'www.kolonmall.com', 'm.kolonmall.com']) {
    test(`saved Kolon ${status} at ${host} collects one merchant`, async () => {
      let requests = 0;
      const result = await queryDomesticProducts({ ...product, enabledSourceGroups: ['official', 'retailers'],
        officialBrandRecord: { status, homepageUrl: `https://${host}/KOLONSPORT` },
        fetchImpl: async () => { requests++; return new Response(emptyPage); } });
      assert.deepEqual(result.sources.map(s => s.store), ['브랜드 공식몰']);
      assert.equal(requests, 0);
    });
  }
}

test('an unrelated host containing the Kolon name cannot suppress the retailer', async () => {
  const result = await queryDomesticProducts({ ...product, enabledSourceGroups: ['official', 'retailers'],
    officialBrandRecord: { status: 'verified', homepageUrl: 'https://kolonmall.com.example.test/' },
    fetchImpl: async () => new Response(emptyPage) });
  assert.deepEqual(result.sources.map(s => s.store), ['브랜드 공식몰', '코오롱몰']);
});

test('disabling official search keeps the explicitly selected Kolon retailer', async () => {
  const result = await queryDomesticProducts({ ...product, enabledSourceGroups: ['retailers'],
    fetchImpl: async () => new Response(emptyPage) });
  assert.deepEqual(result.sources.map(s => s.store), ['코오롱몰']);
});

test('another official merchant does not suppress Kolon retailer search', async () => {
  const result = await queryDomesticProducts({ ...product, brand: '나이키', enabledSourceGroups: ['official', 'retailers'],
    fetchImpl: async () => new Response(emptyPage) });
  assert.deepEqual(result.sources.map(s => s.store), ['브랜드 공식몰', '코오롱몰']);
});

test('manual retailer links retain the exact code independently of the last fallback', async () => {
  const result = await queryDomesticProducts({ ...product, enabledSourceGroups: ['musinsa', 'lotte'],
    fetchImpl: async () => new Response(emptyPage) });
  for (const source of result.sources) {
    const url = new URL(source.manualSearchUrl);
    assert.equal(url.searchParams.get('keyword') || url.searchParams.get('q'), product.articleNumber);
    assert.equal(source.searchAttempts[0].query, product.articleNumber);
    assert.equal(source.searchQuery, product.articleNumber);
  }
});

function officialWindowHarness(overrides = {}) {
  const windows = [];
  const ctx = {
    URL, sanitizeDomesticProductCode, sanitizeDomesticQuery,
    DOMESTIC_SEARCH_PARTITION: 'fixture', APP_ICON_PATH: '', officialInteractiveWindows: new Set(),
    BrowserWindow: class {
      constructor(options) {
        this.visible = options.show; this.webContents = { setUserAgent() {}, setWindowOpenHandler() {}, getURL: () => 'https://www.kolonmall.com/Search?keyword=TVJDW25612' };
        windows.push(this);
      }
      on() {} show() { this.visible = true; } hide() { this.visible = false; } focus() { this.focused = true; } setTitle() {}
    },
    browserWindowUsable: () => true,
    loadOfficialPageForAutomation: async () => true,
    ensureOfficialAccountLogin: async () => ({ ok: true }),
    executeOfficialMallSearch: async () => true,
    collectOfficialMallSearchProducts: async () => [{ url: 'https://www.kolonmall.com/Product/TVJDW25612OAT', title: '다운' }],
    ...overrides,
  };
  const open = runInNewContext(section(main, 'function closedInternalSearchResult', 'async function waitForDomesticCaptureReady') + '\nopenOfficialMallInternalSearch', ctx);
  return { open, windows };
}

test('manual official open stays visible on success, even while collection is pending', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = officialWindowHarness({ collectOfficialMallSearchProducts: () => pending });
  const request = h.open('https://www.kolonmall.com/KOLONSPORT', product.articleNumber);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.windows[0].visible, true);
  finish([{ url: 'https://www.kolonmall.com/Product/TVJDW25612OAT' }]);
  assert.equal((await request).ok, true);
  assert.equal(h.windows[0].visible, true);
  assert.equal(h.windows[0].focused, true);
});

test('manual official empty results still leave the actual result window visible', async () => {
  const h = officialWindowHarness({ collectOfficialMallSearchProducts: async () => [] });
  const result = await h.open('https://www.kolonmall.com/KOLONSPORT', product.articleNumber);
  assert.equal(result.count, 0);
  assert.equal(h.windows[0].visible, true);
});

function credentialReader(settings, decrypt = value => value === 'encrypted-fixture' ? 'fixture-password' : '') {
  return runInNewContext(section(main, 'function naverAccountCredentials()', 'async function submitStoredNaverCredentials')
    + '\nnaverAccountCredentials()', { store: { snapshot: () => ({ settings }) }, decrypted: decrypt });
}

test('saved Naver credentials distinguish missing, readable, and unreadable encryption', () => {
  assert.equal(credentialReader({}).code, 'NAVER_CREDENTIALS_REQUIRED');
  assert.equal(credentialReader({ naverLoginId: ' fixture ', naverPasswordEncrypted: 'encrypted-fixture' }).code, '');
  const unreadable = credentialReader({ naverLoginId: 'fixture', naverPasswordEncrypted: 'other-pc' }, () => { throw new Error('sensitive-detail'); });
  assert.equal(unreadable.code, 'NAVER_CREDENTIALS_UNREADABLE');
  assert.equal(unreadable.password, '');
  assert.doesNotMatch(JSON.stringify(unreadable), /sensitive-detail/);
});

function configSaver(settings) {
  let handler;
  const ctx = { ipcMain: { handle: (_name, fn) => { handler = fn; } },
    store: { snapshot: () => ({ settings }), setSettingsCommitted: async next => Object.assign(settings, next) },
    encrypted: () => 'new-encrypted-fixture', publicConfig: () => ({ hasNaverPassword: Boolean(settings.naverPasswordEncrypted) }) };
  runInNewContext(section(main, '  ipcMain.handle("config:save"', '  ipcMain.handle("ledger:open-musinsa"'), ctx);
  return config => handler(null, config);
}

test('saving unrelated settings cannot erase the saved Naver login ID', async () => {
  const settings = { naverLoginId: 'fixture', naverPasswordEncrypted: 'encrypted-fixture' };
  await configSaver(settings)({ ledgerWebhookUrl: 'https://example.test' });
  assert.equal(settings.naverLoginId, 'fixture');
  assert.equal(settings.naverPasswordEncrypted, 'encrypted-fixture');
});

test('changing Naver ID cannot silently reuse the old account password', async () => {
  const settings = { naverLoginId: 'fixture', naverPasswordEncrypted: 'encrypted-fixture' };
  await assert.rejects(configSaver(settings)({ naverLoginId: 'different', naverPassword: '' }), /NAVER_PASSWORD_REQUIRED_ON_ACCOUNT_CHANGE/);
  assert.equal(settings.naverLoginId, 'fixture');
  await configSaver(settings)({ naverLoginId: 'different', naverPassword: 'new-fixture-password' });
  assert.equal(settings.naverLoginId, 'different');
  assert.equal(settings.naverPasswordEncrypted, 'new-encrypted-fixture');
});

test('official button unlocks on cancel or IPC rejection without declaring product absence', async () => {
  const source = section(renderer, '  const officialInternalButton = event.target.closest', '  const officialButton = event.target.closest');
  for (const outcome of ['cancel', 'error']) {
    const button = { dataset: { officialHomepage: encodeURIComponent('https://www.kolonmall.com'), officialQuery: 'TVJDW25612' }, disabled: false, textContent: '열기' };
    await runInNewContext('(async () => {' + source + '})()', {
      event: { target: { closest: () => button } },
      window: { aroundG: { openOfficialInternalSearch: async () => { if (outcome === 'error') throw new Error('fixture'); return { canceled: true }; } } },
    });
    assert.equal(button.disabled, false, outcome);
    assert.doesNotMatch(button.textContent, /상품 없음|검색 결과 없음|가져오는 중/);
  }
});

function sourceActions() {
  const inline = readFileSync(new URL('../src/domestic-inline-results.js', import.meta.url), 'utf8');
  const sourcing = readFileSync(new URL('../src/sourcing-view.js', import.meta.url), 'utf8');
  const ctx = { URL, window: { aroundG: { openDomesticResult() {} } }, sourceProduct: product, result: {}, contextKey: 'fixture' };
  return [
    runInNewContext(section(inline, '  function sourceAction(', '  function renderSearchDiagnostics') + '\nsourceAction', { ...ctx }),
    runInNewContext(section(renderer, '  const sourceAction = (source, label', '  const sourceStatus =') + '\n(source, p, input) => sourceAction(source)', { ...ctx }),
    runInNewContext(section(sourcing, '        const sourceAction = (source, product', '        const productRows =') + '\nsourceAction', { ...ctx }),
  ];
}

test('all three product views open the exact code instead of the last title fallback', () => {
  for (const action of sourceActions()) {
    for (const store of ['무신사', '롯데온']) {
      const exact = store === '무신사' ? 'https://www.musinsa.com/search/goods?keyword=TVJDW25612'
        : 'https://www.lotteon.com/csearch/search/search?q=TVJDW25612';
      const html = action({ store, searchUrl: 'https://example.test/?q=last-fallback',
        searchAttempts: [{ query: product.articleNumber, url: exact }], searchQuery: product.title }, {}, product);
      assert.ok(html.includes(encodeURIComponent(exact)), html);
      assert.ok(!html.includes('last-fallback'), html);
    }
  }
});

test('verified official product links open directly and do not restart collection', () => {
  for (const action of sourceActions()) {
    const url = 'https://www.kolonmall.com/Product/TVJDW25612OAT';
    const html = action({ store: '브랜드 공식몰', officialStatus: 'verified', verifiedProductUrl: url,
      homepageUrl: 'https://www.kolonmall.com/KOLONSPORT' }, {}, product);
    assert.ok(html.includes(encodeURIComponent(url)), html);
    assert.doesNotMatch(html, /data-official-homepage/);
  }
});

test('account-required rows have working recovery actions even without a search URL', () => {
  for (const action of sourceActions()) {
    const html = action({ store: '네이버 패션타운', loginRequired: true }, {}, product);
    assert.match(html, /data-naver-account-settings/);
    assert.match(html, /data-domestic-login-source="naver"/);
    assert.doesNotMatch(html, /disabled/);
  }
});

test('unreadable Naver password is pending recovery, not search failure or absence', () => {
  const ctx = {};
  runInNewContext(readFileSync(new URL('../src/domestic-result-verdict.js', import.meta.url), 'utf8'), ctx);
  const verdict = ctx.AroundGDomesticVerdict.sourceVerdict({ store: '네이버 패션타운', loginRequired: true, errorCode: 'NAVER_CREDENTIALS_UNREADABLE' });
  assert.equal(verdict.label, '네이버 비밀번호 다시 저장 필요');
  assert.equal(verdict.state, 'login');
});

test('saved credential errors remain source-scoped and do not open an empty login popup', async () => {
  for (const code of ['NAVER_CREDENTIALS_REQUIRED', 'NAVER_CREDENTIALS_UNREADABLE']) {
    let opened = 0;
    const ctx = {
      domesticLoginSourceIdsForSearch: () => ['naver'], domesticLoginSource: () => ({ id: 'naver', name: '네이버' }),
      hasUsableDomesticLoginSession: async () => false, naverAccountCredentials: () => ({ code }),
      naverCredentialMessage: () => '안내', mainWindow: { webContents: { send() {} } },
      domesticLoginFailure: (_source, code) => ({ code }), openDomesticLogin: async () => { opened++; },
    };
    const result = await runInNewContext(section(main, 'async function waitForDomesticLoginsBeforeSearch', 'async function domesticLoginStatuses')
      + '\nwaitForDomesticLoginsBeforeSearch(["naver"])', ctx);
    assert.equal(result.failures[0].code, code);
    assert.equal(opened, 0);
  }
});

test('existing authenticated session works without a stored password', async () => {
  const ctx = { domesticLoginSourceIdsForSearch: () => ['naver'], domesticLoginSource: () => ({ id: 'naver' }),
    hasUsableDomesticLoginSession: async () => true,
    naverAccountCredentials: () => { throw new Error('must reuse session first'); } };
  const result = await runInNewContext(section(main, 'async function waitForDomesticLoginsBeforeSearch', 'async function domesticLoginStatuses')
    + '\nwaitForDomesticLoginsBeforeSearch(["naver"])', ctx);
  assert.equal(result.ok, true);
});

test('public config returns credential health, never the decrypted password', () => {
  const ctx = { store: { snapshot: () => ({ settings: { naverLoginId: 'fixture', naverPasswordEncrypted: 'encrypted-fixture' } }) },
    naverAccountCredentials: () => ({ code: '', password: 'fixture-secret' }), naverCredentialMessage: () => '' };
  const config = runInNewContext(section(main, 'function publicConfig()', 'function openMusinsaLedgerWindow') + '\npublicConfig()', ctx);
  assert.equal(config.naverCredentialCode, '');
  assert.doesNotMatch(JSON.stringify(config), /fixture-secret|encrypted-fixture/);
});
