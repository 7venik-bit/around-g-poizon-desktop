import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { JsonStore } from '../services/store.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'around-g-store-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new JsonStore(directory);
  await store.load();
  return store;
}

for (const phase of ['write', 'rename']) {
  test(`a ${phase} failure reaches its caller and the next save recovers`, async t => {
    const store = await fixture(t);
    // A directory at the relevant file path creates a real filesystem error
    // without timing assumptions or platform-dependent permission changes.
    const obstruction = phase === 'write' ? `${store.path}.tmp` : store.path;
    if (phase === 'rename') await rm(store.path);
    await mkdir(obstruction);

    await assert.rejects(store.setSettings({ beforeRecovery: true }));
    await rm(obstruction, { recursive: true });
    await store.setSettings({ afterRecovery: true });

    const reopened = new JsonStore(dirname(store.path));
    const persisted = await reopened.load();
    assert.deepEqual(persisted.settings, {
      beforeRecovery: true,
      afterRecovery: true,
    });
  });
}

test('queued callers each receive failure and concurrent saves work after recovery', async t => {
  const store = await fixture(t);
  const obstruction = `${store.path}.tmp`;
  await mkdir(obstruction);

  const failedWrites = await Promise.allSettled([
    store.setSettings({ failedFirst: true }),
    store.setSettings({ failedSecond: true }),
  ]);
  assert.deepEqual(failedWrites.map(result => result.status), ['rejected', 'rejected']);
  for (const result of failedWrites) assert.ok(result.reason instanceof Error);
  assert.deepEqual(JSON.parse(await readFile(store.path, 'utf8')).settings, {});

  await rm(obstruction, { recursive: true });
  const successfulWrites = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
    store.setSettings({ [`concurrent${index}`]: index })));
  assert.ok(successfulWrites.every(result => result.status === 'fulfilled'));
  const persisted = JSON.parse(await readFile(store.path, 'utf8'));
  assert.deepEqual(persisted.settings, {
    failedFirst: true,
    failedSecond: true,
    ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`concurrent${index}`, index])),
  });
});

for (const phase of ['write', 'rename']) {
  test(`committed upsert leaves memory unchanged on ${phase} failure and recovers`, async t => {
    const store = await fixture(t);
    const original = await store.upsertCommitted('domesticSearches', { id: 'job', status: 'pending' });
    const obstruction = phase === 'write' ? `${store.path}.tmp` : store.path;
    if (phase === 'rename') await rm(store.path);
    await mkdir(obstruction);

    const failed = await Promise.allSettled([
      store.upsertCommitted('domesticSearches', { id: 'job', status: 'complete' }),
      store.upsertCommitted('domesticSearches', { id: 'new', status: 'complete' }),
    ]);
    assert.deepEqual(failed.map(result => result.status), ['rejected', 'rejected']);
    assert.deepEqual(store.list('domesticSearches'), [original]);
    await rm(obstruction, { recursive: true });
    const completed = await store.upsertCommitted('domesticSearches', { id: 'job', status: 'complete' });
    assert.deepEqual(store.list('domesticSearches'), [completed]);
    assert.deepEqual(JSON.parse(await readFile(store.path, 'utf8')).domesticSearches, [completed]);
  });
}

test('committed upsert preserves ordinary settings and other rows changed during its write', async t => {
  const store = await fixture(t);
  const input = { id: 'committed', status: 'complete', evidence: { count: 1 } };
  const committed = store.upsertCommitted('domesticSearches', input);
  input.evidence.count = 999;
  // The queued transaction takes its snapshot before this continuation; its
  // asynchronous file write is still pending when ordinary mutations occur.
  await Promise.resolve();
  assert.deepEqual(store.list('domesticSearches'), []);
  const settings = store.setSettings({ concurrentSetting: 'retained' });
  const ordinary = store.upsert('domesticSearches', { id: 'ordinary', status: 'pending' });
  const anotherCollection = store.upsert('ledger', { id: 'ledger-row', amount: 17 });
  const [saved] = await Promise.all([committed, settings, ordinary, anotherCollection]);
  assert.equal(saved.evidence.count, 1);
  saved.evidence.count = 555;
  const memory = store.snapshot();
  assert.equal(memory.settings.concurrentSetting, 'retained');
  assert.deepEqual(memory.domesticSearches.map(row => row.id).sort(), ['committed', 'ordinary']);
  assert.equal(memory.domesticSearches.find(row => row.id === 'committed').evidence.count, 1);
  assert.equal(memory.ledger[0].amount, 17);
  const disk = JSON.parse(await readFile(store.path, 'utf8'));
  assert.deepEqual(disk, memory);
});
