import test from 'node:test';
import assert from 'node:assert/strict';
import {JsonStore} from '../services/store.mjs';
import {DomesticRecoveryCoordinator} from '../services/domestic-recovery.mjs';

test('settings reads stay detached without traversing unrelated saved category results', () => {
  const store = new JsonStore('unused');
  store.data.settings = {brandSearchProfiles:{descente:{query:'SR123UPS11'}}};
  Object.defineProperty(store.data, 'categorySearches', {enumerable:true,get(){throw Error('large collection was read');}});
  const result = store.snapshot(['settings']);
  assert.deepEqual(Object.keys(result), ['settings']);
  result.settings.brandSearchProfiles.descente.query = 'CHANGED';
  assert.equal(store.data.settings.brandSearchProfiles.descente.query, 'SR123UPS11');
});

test('pending domestic work remains readable without cloning unrelated category results', () => {
  const store = new JsonStore('unused');
  store.data.domesticRecoveryJobs = [{id:'resume',version:1,status:'pending',products:[]}];
  Object.defineProperty(store.data,'categorySearches',{enumerable:true,get(){throw Error('unrelated collection read');}});
  const recovery = new DomesticRecoveryCoordinator(store);
  const job = recovery.get('resume');
  job.status = 'changed';
  assert.equal(recovery.get('resume').status,'pending');
});

test('a full snapshot still includes detached saved category results', () => {
  const store = new JsonStore('unused');
  store.data.categorySearches = [{id:'saved',products:[{articleNumber:'SR123UPS11'}]}];
  const result = store.snapshot();
  result.categorySearches[0].products[0].articleNumber = 'CHANGED';
  assert.equal(store.data.categorySearches[0].products[0].articleNumber, 'SR123UPS11');
  assert.ok(result.settings);
});
