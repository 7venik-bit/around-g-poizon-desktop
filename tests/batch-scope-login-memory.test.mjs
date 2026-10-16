import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const main = readFileSync(new URL("../main.mjs", import.meta.url), "utf8");

function loadScopeMemory() {
  const start = main.indexOf("// Batch-scope login memory:");
  assert.notEqual(start, -1);
  const end = main.indexOf("// Moves the external window session", start);
  assert.notEqual(end, -1);
  const source = `${main.slice(start, end)}
this.batchLoginScopeFailures = batchLoginScopeFailures;
this.rememberBatchLoginFailure = rememberBatchLoginFailure;
this.blockedBatchLoginScopes = blockedBatchLoginScopes;
this.BATCH_LOGIN_SCOPE_TTL_MS = BATCH_LOGIN_SCOPE_TTL_MS;`;
  const sandbox = {};
  runInNewContext(source, sandbox);
  return sandbox;
}

test("a remembered login failure is replayed for the same batch scope only", () => {
  const scope = loadScopeMemory();
  const failure = { sourceId: "musinsa", code: "DOMESTIC_LOGIN_REQUIRED" };
  scope.rememberBatchLoginFailure("renderer:7", failure);
  assert.equal(scope.batchLoginScopeFailures("renderer:7").get("musinsa"), failure);
  assert.equal(scope.batchLoginScopeFailures("renderer:8").get("musinsa"), undefined);
  assert.equal(scope.batchLoginScopeFailures("").size, 0);
  assert.equal(scope.batchLoginScopeFailures("renderer:7").get("naver"), undefined);
});

test("remembered failures expire and the ledger stays capped", () => {
  const scope = loadScopeMemory();
  scope.rememberBatchLoginFailure("renderer:7", { sourceId: "ssg" }, 1_000);
  assert.equal(scope.batchLoginScopeFailures("renderer:7", 2_000).size, 1);
  assert.equal(scope.batchLoginScopeFailures("renderer:7", 1_000 + scope.BATCH_LOGIN_SCOPE_TTL_MS + 1).size, 0);
  for (let i = 0; i < 1_005; i += 1) {
    scope.rememberBatchLoginFailure(`renderer:scope-${i}`, { sourceId: "lotte" }, 5_000);
  }
  assert.ok(scope.blockedBatchLoginScopes.size <= 1_000);
});

test("the login preflight consults batch memory before opening any window", () => {
  const start = main.indexOf("async function waitForDomesticLoginsBeforeSearch(");
  assert.notEqual(start, -1);
  const end = main.indexOf("async function domesticLoginStatuses(", start);
  const fn = main.slice(start, end);
  const consulted = fn.indexOf("batchLoginScopeFailures(loginScopeId).get(sourceId)");
  assert.notEqual(consulted, -1);
  assert.ok(consulted < fn.indexOf("openRetailerLoginForSearch"), "memory must short-circuit before external windows");
  assert.ok(consulted < fn.indexOf("await openDomesticLogin("), "memory must short-circuit before in-app windows");
  assert.match(fn, /typeof batchLoginScopeFailures === "function"/);
  assert.match(main, /typeof rememberBatchLoginFailure === "function"/);
  const remembered = fn.match(/noteBatchLoginFailure\(loginScopeId,/g) || [];
  assert.ok(remembered.length >= 4, `expected external/credential/closed/timeout notes, found ${remembered.length}`);
  assert.match(fn, /typeof noteBatchLoginFailure === "function"/);
});
