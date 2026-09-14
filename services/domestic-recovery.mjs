import { createHash, randomUUID } from 'node:crypto';
import { mergeRetailerStockProducts } from './retailer-stock-strategies.mjs';

const COLLECTION = 'domesticRecoveryJobs';
const GROUPS = ['official', 'musinsa', 'naver', 'ssg', 'lotte', 'parallel', 'retailers'];
const copy = value => structuredClone(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp = now => new Date(now()).toISOString();
const belongsTo = (product, source) => (product.sourceStore || product.store) === source
  || (!product.sourceStore && source === 'SSG' && String(product.store).startsWith('SSG'));

export function stockObservationComplete(product = {}) {
  return product.stockVerified === true && !['partial', 'unknown'].includes(product.stockCoverage)
    && product.stockStatus !== 'login_required'
    && (product.sizes || []).every(option => typeof option.inStock === 'boolean');
}

export function domesticObservationComplete(data = {}) {
  if (data.partial || !data.sources?.length) return false;
  return data.sources.every(source => {
    if (source.verificationFailed || source.verificationPending || source.loginRequired || source.securityVerificationRequired) return false;
    if (source.absenceConfirmed === true && Number(source.count) === 0) return true;
    const products = (data.products || []).filter(product => belongsTo(product, source.store));
    return products.length > 0 && products.every(stockObservationComplete);
  });
}

export function mergeDomesticCheckpoint(previous = {}, next = {}) {
  const {recoveryCheckpoint: _checkpoint, ...cleanNext} = next;
  const absent = new Set((next.sources || []).filter(s => s.absenceConfirmed === true && Number(s.count) === 0).map(s => s.store));
  return {...previous, ...cleanNext,
    products: mergeRetailerStockProducts([...(previous.products || []).filter(p => ![...absent].some(source => belongsTo(p, source))), ...(next.products || [])]),
    sources: [...new Map([...(previous.sources || []), ...(next.sources || [])].map(s => [s.store, s])).values()],
    optionCheckpoints: {...previous.optionCheckpoints, ...next.optionCheckpoints},
  };
}

function requiresInteraction(data = {}) {
  data ||= {};
  return (data.sources || []).some(s => s.loginRequired || s.securityVerificationRequired
    || /captcha|access.?denied|blocked|보안|접근.?차단|로그인|next_day|cooldown/i.test(s.verificationReason || ''))
    || (data.products || []).some(p => p.stockStatus === 'login_required');
}

// Only interrupted work is reusable. Completed new searches always create a
// new job; a resume rechecks observations older than the freshness window.
export class DomesticRecoveryCoordinator {
  constructor(store, {now = Date.now, freshnessMs = 30 * 60_000, retryDelayMs = 10_000,
    delay = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
    this.store = store; this.now = now; this.freshnessMs = freshnessMs;
    this.retryDelayMs = retryDelayMs; this.delay = delay; this.active = new Set();
    this.activeRuns = new Map();
  }
  jobs() { return this.store.snapshot()[COLLECTION] || []; }
  get(id) { return this.jobs().find(job => job.id === id); }
  async save(job) {
    job.status = job.products.every(p => p.tasks.every(t => t.status === 'complete')) ? 'complete' : 'pending';
    await this.store.upsertCommitted(COLLECTION, job);
  }
  expire(job) {
    for (const product of job.products) for (const task of product.tasks) {
      if (!Number.isFinite(Date.parse(task.observedAt)) || this.now() - Date.parse(task.observedAt) > this.freshnessMs) {
        task.status = 'pending'; task.data = null; task.checkedAt = null; task.observedAt = null;
      } else if (task.status === 'running') task.status = 'pending';
    }
  }
  result(job, product) {
    const tasks = product.tasks;
    let data = {products: [], sources: []};
    for (const task of tasks) data = mergeDomesticCheckpoint(data, task.data || {});
    const pending = tasks.filter(t => t.status !== 'complete');
    return {...data, partial: pending.length > 0,
      message: pending.length ? `판매처 ${tasks.length - pending.length}/${tasks.length}곳 확인 · 미완료 항목을 보관했습니다.` : '상품과 재고 확인을 완료했습니다.',
      recovery: {jobId: job.id, productKey: product.key, status: pending.length ? 'pending' : 'complete',
        checkedAt: tasks.map(t => t.observedAt).filter(Boolean).sort()[0] || null,
        pendingSourceGroups: pending.map(t => t.group),
        completedSourceGroups: tasks.filter(t => t.status === 'complete').map(t => t.group)},
    };
  }
  describe(job, resumed = true) {
    return {id: job.id, scope: job.scope, resumed,
      results: job.products.map(product => ({key: product.key, result: this.result(job, product)})),
      pendingKeys: job.products.filter(p => p.tasks.some(t => t.status !== 'complete')).map(p => p.key)};
  }
  async start({scope = '', products = [], sourceGroups = GROUPS} = {}) {
    if (!products.length || products.length > 10000) throw new Error('RECOVERY_PRODUCTS_INVALID');
    const groups = [...new Set(sourceGroups.filter(g => GROUPS.includes(g)))].sort();
    if (!groups.length) throw new Error('RECOVERY_SOURCES_EMPTY');
    const items = [...new Map(products.map(p => [String(p.key), {key: String(p.key), input: copy(p.input), product: copy(p.product || {})}])).values()];
    if (items.some(p => !p.key || !p.input)) throw new Error('RECOVERY_IDENTITY_MISSING');
    const scopeKey = digest([String(scope), groups, items.map(p => [p.key, p.input.articleNumber, p.input.productCode, p.input.brand, p.input.brandId, p.input.title]).sort((a,b)=>a[0].localeCompare(b[0]))]);
    // A subset selection resumes the same unfinished batch. Adding products
    // extends it, avoiding orphaned duplicate jobs and stale retry notices.
    let job = this.jobs().find(j => j.version === 1 && j.scope === String(scope) && j.status !== 'complete'
      && JSON.stringify(j.products[0]?.tasks.map(t => t.group).sort()) === JSON.stringify(groups));
    const resumed = Boolean(job);
    if (job && this.active.has(job.id)) throw new Error('RECOVERY_ALREADY_RUNNING');
    job = job ? copy(job) : {id:randomUUID(), version:1, scope:String(scope), createdAt:stamp(this.now), products:[]};
    job.scopeKey = scopeKey;
    for (const item of items) {
      const index = job.products.findIndex(p => p.key === item.key);
      const old = job.products[index];
      const product = {...item, tasks: groups.map(group => copy(old && digest(old.input) === digest(item.input)
        ? old.tasks.find(t => t.group === group) : {group, status:'pending', attempts:0, data:null}))};
      if (index < 0) job.products.push(product); else job.products[index] = product;
    }
    this.expire(job);
    await this.save(job);
    return this.describe(job, resumed);
  }
  pending() {
    return this.jobs().filter(j => j.version === 1 && j.status !== 'complete')
      .map(j => ({id: j.id, scope: j.scope, createdAt: j.createdAt, products: j.products.map(p => ({key:p.key, product:p.product})),
        pending: j.products.filter(p => p.tasks.some(t => t.status !== 'complete')).length}));
  }
  async cancelable(promise, canceled) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      const check = () => { if (canceled()) reject(new Error('DOMESTIC_SEARCH_CANCELED')); else timer = setTimeout(check, 100); };
      check();
    })]); } finally { clearTimeout(timer); }
  }
  async run({jobId, productKey, execute, canceled = () => false, onProgress = () => {}}) {
    // The renderer can reach its absolute deadline just before the previous
    // IPC call finishes saving and releasing this job. Queue the next product
    // behind that cleanup instead of failing every remaining row with
    // RECOVERY_ALREADY_RUNNING.
    while (this.activeRuns.has(jobId)) await this.activeRuns.get(jobId);
    let job = copy(this.get(jobId));
    if (!job) throw new Error('RECOVERY_JOB_MISSING');
    const product = job.products.find(p => p.key === productKey);
    if (!product) throw new Error('RECOVERY_PRODUCT_MISSING');
    let releaseRun;
    const runFinished = new Promise(resolve => { releaseRun = resolve; });
    this.activeRuns.set(jobId, runFinished);
    this.active.add(jobId);
    let interrupted = false;
    try {
      for (const task of product.tasks) {
        if (!Number.isFinite(Date.parse(task.observedAt)) || this.now() - Date.parse(task.observedAt) > this.freshnessMs) {
          task.status = 'pending'; task.data = null; task.observedAt = null;
        }
        if (task.status === 'complete') continue;
        if (canceled()) { interrupted = true; break; }
        for (let attempt = 0; attempt < 2; attempt++) {
          if (canceled()) { interrupted = true; break; }
          task.status = 'running'; task.attempts++; await this.save(job);
          let response;
          let accepting = true;
          const checkpoint = async data => {
            if (!accepting || canceled()) return;
            task.data = mergeDomesticCheckpoint(task.data || {}, data);
            task.checkedAt = stamp(this.now);
            task.observedAt ||= task.checkedAt;
            await this.save(job);
          };
          try {
            response = await this.cancelable(execute({...product.input, sourceGroups: [task.group], verifyLinkCounts: true,
              recoveryCheckpoint: copy(task.data || {})}, checkpoint), canceled);
          } catch (error) {
            response = {ok: false, canceled: canceled(), message: error.message};
          } finally { accepting = false; }
          if (response?.data) task.data = mergeDomesticCheckpoint(task.data || {}, response.data);
          task.checkedAt = stamp(this.now);
          task.observedAt ||= task.checkedAt;
          const complete = response?.ok && !response.canceled && !response.timedOut && domesticObservationComplete(response.data);
          task.status = complete ? 'complete' : 'pending';
          task.lastError = complete ? '' : response?.message || response?.data?.message || '재고 수집 미완료';
          // A partial flag from a previous checkpoint must not taint a fully
          // verified response forever. Completion is based on this attempt.
          if (complete) task.data.partial = false;
          await this.save(job);
          onProgress({completed: product.tasks.filter(t => t.status === 'complete').length,
            total: product.tasks.length, source: task.group, phase: complete ? 'completed' : 'pending'});
          if (response?.canceled || canceled()) { interrupted = true; break; }
          if (complete || requiresInteraction(task.data) || attempt === 1) break;
          onProgress({source: task.group, phase: 'retry_wait', message: '미완료 판매처를 잠시 후 다시 확인합니다.'});
          try { await this.cancelable(this.delay(this.retryDelayMs), canceled); }
          catch { interrupted = true; break; }
        }
        if (interrupted) break;
      }
      return {ok: true, ...(interrupted ? {canceled: true} : {}), data: this.result(job, product)};
    } finally {
      this.active.delete(jobId);
      if (this.activeRuns.get(jobId) === runFinished) this.activeRuns.delete(jobId);
      releaseRun();
    }
  }
}
