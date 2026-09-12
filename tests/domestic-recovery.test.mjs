import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../services/store.mjs';
import { DomesticRecoveryCoordinator } from '../services/domestic-recovery.mjs';

const names = { official: '브랜드 공식몰', musinsa: '무신사', naver: '네이버 패션타운' };
const item = key => ({ key, input: { articleNumber: key, query: key, brand: '테스트' }, product: { title: key } });
const good = (group, extra = {}) => ({
  sources: [{ store: names[group], count: 1, countVerified: true, searchCompleted: true }],
  products: [{ id: `${group}:product`, store: names[group], url: `https://example.test/${group}`,
    stockVerified: true, stockCoverage: 'observed', stockStatus: 'available', inStock: true,
    sizes: [{ label: '95', inStock: true, quantity: 3 }], ...extra }],
});
const failure = group => ({ sources: [{ store: names[group], verificationFailed: true }], products: [] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'around-g-recovery-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const open = async () => {
    const store = new JsonStore(directory);
    await store.load();
    return { store, coordinator: new DomesticRecoveryCoordinator(store, { delay: async () => {}, ...options }) };
  };
  return { ...await open(), open };
}

async function start(coordinator, groups = ['official'], keys = ['A']) {
  return coordinator.start({ scope: 'workbook:sheet', products: keys.map(item), sourceGroups: groups });
}

test('restart retains successful retailer stock and runs only the failed group', async t => {
  const f = await fixture(t);
  const job = await start(f.coordinator, ['official', 'musinsa']);
  const initialCalls = [];
  const initial = await f.coordinator.run({ jobId: job.id, productKey: 'A', execute: async input => {
    const group = input.sourceGroups[0]; initialCalls.push(group);
    return group === 'official' ? { ok: true, data: good(group) } : { ok: false, data: failure(group) };
  } });
  assert.equal(initial.data.partial, true);
  assert.deepEqual(initialCalls, ['musinsa', 'musinsa', 'official']);

  const reopened = await f.open();
  const resumed = await start(reopened.coordinator, ['official', 'musinsa']);
  assert.equal(resumed.id, job.id);
  assert.equal(resumed.resumed, true);
  const calls = [];
  const result = await reopened.coordinator.run({ jobId: resumed.id, productKey: 'A', execute: async input => {
    calls.push(input.sourceGroups[0]); return { ok: true, data: good(input.sourceGroups[0]) };
  } });
  assert.deepEqual(calls, ['musinsa']);
  assert.equal(result.data.partial, false);
  assert.equal(result.data.products.length, 2);
  assert.equal(reopened.coordinator.pending().length, 0);
  assert.equal((await f.open()).coordinator.get(job.id).status, 'complete');
});

test('checkpoint is durable before cancellation and late callbacks cannot overwrite a resumed job', async t => {
  const f = await fixture(t);
  const job = await start(f.coordinator);
  const checkpointed = deferred(), oldResponse = deferred();
  let canceled = false, lateCheckpoint;
  const running = f.coordinator.run({ jobId: job.id, productKey: 'A', canceled: () => canceled,
    execute: async (_input, checkpoint) => {
      lateCheckpoint = checkpoint;
      await checkpoint({ ...good('official'), partial: true,
        optionCheckpoints: { 'https://example.test/official': { checkedAt: new Date().toISOString(),
          options: [{ label: '95', optionPath: ['95'], inStock: true, quantity: 3 }] } } });
      checkpointed.resolve();
      return oldResponse.promise;
    } });
  await checkpointed.promise;
  const whileRunning = await f.open();
  const task = whileRunning.coordinator.get(job.id).products[0].tasks[0];
  assert.equal(task.data.products[0].sizes[0].quantity, 3);
  assert.equal(task.data.optionCheckpoints['https://example.test/official'].options[0].quantity, 3);
  canceled = true;
  const interrupted = await running;
  assert.equal(interrupted.canceled, true);
  assert.equal(interrupted.data.partial, true);

  const reopened = await f.open();
  const resumed = await start(reopened.coordinator);
  await reopened.coordinator.run({ jobId: resumed.id, productKey: 'A', execute: async input => {
    assert.equal(input.recoveryCheckpoint.products[0].sizes[0].quantity, 3);
    return { ok: true, data: good('official', { sizes: [{ label: '95', inStock: true, quantity: 9 }] }) };
  } });
  const committed = await readFile(f.store.path, 'utf8');
  await lateCheckpoint(good('official', { sizes: [{ label: '95', inStock: true, quantity: 999 }] }));
  oldResponse.resolve({ ok: true, data: good('official', { inStock: false }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await readFile(f.store.path, 'utf8'), committed);
  assert.equal((await f.open()).coordinator.get(job.id).status, 'complete');
});

test('a new search after completion creates a fresh job and checks stock again', async t => {
  const f = await fixture(t);
  const first = await start(f.coordinator);
  await f.coordinator.run({ jobId: first.id, productKey: 'A', execute: async () => ({ ok: true, data: good('official') }) });
  const second = await start(f.coordinator);
  assert.notEqual(second.id, first.id);
  assert.equal(second.resumed, false);
  let calls = 0;
  await f.coordinator.run({ jobId: second.id, productKey: 'A', execute: async input => {
    calls++; assert.equal(input.recoveryCheckpoint.products?.length || 0, 0);
    return { ok: true, data: good('official') };
  } });
  assert.equal(calls, 1);
});

test('expired completed stock is rechecked even when run follows start without another start', async t => {
  let now = 1000;
  const f = await fixture(t, { now: () => now, freshnessMs: 100 });
  const job = await start(f.coordinator, ['official', 'musinsa']);
  await f.coordinator.run({ jobId: job.id, productKey: 'A', execute: async input => {
    const group = input.sourceGroups[0];
    return group === 'musinsa' ? { ok: true, data: good(group) } : { ok: false, data: failure(group) };
  } });
  now += 101;
  const calls = [];
  await f.coordinator.run({ jobId: job.id, productKey: 'A', execute: async input => {
    const group = input.sourceGroups[0]; calls.push(group);
    assert.equal(input.recoveryCheckpoint.products?.length || 0, 0);
    return { ok: true, data: good(group) };
  } });
  assert.deepEqual(calls, ['musinsa', 'official']);
});

for (const sourceState of [{ loginRequired: true }, { securityVerificationRequired: true }, { verificationReason: 'access_denied' }]) {
  test(`interaction-required source is retained without automatic retries: ${JSON.stringify(sourceState)}`, async t => {
    const f = await fixture(t);
    const job = await start(f.coordinator);
    let calls = 0;
    const response = await f.coordinator.run({ jobId: job.id, productKey: 'A', execute: async () => {
      calls++; return { ok: true, data: { products: [], sources: [{ store: names.official, ...sourceState }] } };
    } });
    assert.equal(calls, 1);
    assert.equal(response.data.partial, true);
    assert.equal((await f.open()).coordinator.get(job.id).status, 'pending');
  });
}

for (const productState of [{ stockCoverage: 'partial' }, { stockVerified: false }, { sizes: [{ label: '95', inStock: null }] }]) {
  test(`incomplete option evidence cannot complete a task: ${JSON.stringify(productState)}`, async t => {
    const f = await fixture(t);
    const job = await start(f.coordinator);
    let calls = 0;
    const result = await f.coordinator.run({ jobId: job.id, productKey: 'A', execute: async () => {
      calls++; return { ok: true, data: good('official', productState) };
    } });
    assert.equal(calls, 2);
    assert.equal(result.data.recovery.status, 'pending');
    assert.equal((await f.open()).coordinator.get(job.id).status, 'pending');
  });
}

test('failed final persistence never exposes an uncommitted complete job in memory', async t => {
  const f = await fixture(t);
  const job = await start(f.coordinator);
  await assert.rejects(f.coordinator.run({ jobId: job.id, productKey: 'A', execute: async () => {
    await mkdir(`${f.store.path}.tmp`);
    return { ok: true, data: good('official') };
  } }));
  assert.notEqual(f.coordinator.get(job.id).status, 'complete');
  assert.equal(f.coordinator.pending().length, 1);
  assert.deepEqual(f.coordinator.get(job.id), (await f.open()).coordinator.get(job.id));
  await rm(`${f.store.path}.tmp`, { recursive: true });
  const resumed = await start(f.coordinator);
  const result = await f.coordinator.run({ jobId: resumed.id, productKey: 'A', execute: async () => ({ ok: true, data: good('official') }) });
  assert.equal(result.data.recovery.status, 'complete');
});

test('a partial selection shares the existing pending job instead of duplicating it', async t => {
  const f = await fixture(t);
  const original = await start(f.coordinator, ['official'], ['A', 'B']);
  const subset = await start(f.coordinator, ['official'], ['B']);
  assert.equal(subset.id, original.id);
  assert.equal(f.coordinator.jobs().length, 1);
  assert.deepEqual(f.coordinator.get(original.id).products.map(product => product.key).sort(), ['A', 'B']);
});
