import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import vm from "node:vm";
import {
  SIX_STAGE_RETAILER_FLOW,
  hasRetailerBrandEvidence,
  nextRetailerStageAction,
} from "../relay/domestic-search.mjs";

const root = resolve(import.meta.dirname, "..");
const verdictSource = readFileSync(join(root, "src/domestic-result-verdict.js"), "utf8");
const verdictContext = vm.createContext({ Intl, Number, Object, Array });
vm.runInContext(verdictSource, verdictContext);
const { searchStepProgress } = verdictContext.AroundGDomesticVerdict;
const stripStates = (source, products = []) =>
  Object.fromEntries(searchStepProgress(source, products).map((step) => [step.key, step.state]));

test("six stages follow the operator flow order", () => {
  assert.deepEqual(
    SIX_STAGE_RETAILER_FLOW.map((stage) => stage.label),
    ["로그인", "상품검색", "로고확인", "상품인식", "재고확인", "데이터"],
  );
});

test("stage 1: Naver login gates the flow and matches the strip", () => {
  const source = { store: "네이버 패션타운", loginRequired: true };
  assert.deepEqual(nextRetailerStageAction(source, []), {
    stage: "login", action: "manual_login", blocked: true, reason: "login_required",
  });
  assert.equal(stripStates(source).login, "blocked");
});

test("stage 2: a fresh source submits the existing query order", () => {
  const action = nextRetailerStageAction({ store: "무신사" }, []);
  assert.deepEqual(action, { stage: "search", action: "submit_query", blocked: false, reason: "" });
  assert.equal(stripStates({ store: "무신사" }).search, "pending");
});

test("stage 2: a pending search waits instead of resubmitting", () => {
  const source = { store: "무신사", searchSubmitted: true, verificationPending: true };
  assert.equal(nextRetailerStageAction(source, []).action, "await_search");
  assert.equal(stripStates(source).search, "active");
});

test("stage 2: a failed submission is blocked with its reason", () => {
  const source = { store: "SSG", searchSubmitted: true, verificationFailed: true, verificationReason: "page_load_failed" };
  assert.deepEqual(nextRetailerStageAction(source, []), {
    stage: "search", action: "fix_and_resubmit", blocked: true, reason: "page_load_failed",
  });
  assert.equal(stripStates(source).search, "blocked");
});

test("stage 3: products without official/department evidence verify badges first", () => {
  const source = { store: "SSG", searchSubmitted: true, searchCompleted: true };
  const products = [{ price: 84550 }];
  assert.deepEqual(nextRetailerStageAction(source, products), {
    stage: "badges", action: "verify_badges", blocked: false, reason: "brand_evidence_missing",
  });
  assert.equal(stripStates(source, products).badges, "pending");
  assert.equal(hasRetailerBrandEvidence(products), false);
  assert.equal(hasRetailerBrandEvidence([{ officialStoreVerified: true }]), true);
  assert.equal(hasRetailerBrandEvidence([{ departmentStoreLabelMatched: true }]), true);
});

test("stage 3: a brand-name-only parallel importer never passes the logo gate", () => {
  const source = { store: "병행수입·편집샵", searchSubmitted: true, searchCompleted: true, count: 1, countVerified: true };
  const products = [{ brandVerifiedFromCard: true, articleNumberVerified: true, price: 81360, stockVerified: true }];
  assert.deepEqual(nextRetailerStageAction(source, products), {
    stage: "badges", action: "verify_badges", blocked: false, reason: "brand_evidence_missing",
  });
  assert.equal(stripStates(source, products).badges, "pending");
});

test("stage 3: an outlet product proceeds to stock collection", () => {
  const source = { store: "SSG 아울렛", searchSubmitted: true, searchCompleted: true, count: 1, countVerified: true };
  const products = [{ store: "SSG 아울렛", brandVerifiedFromCard: true, articleNumberVerified: true, price: 64000, stockVerified: true }];
  assert.deepEqual(nextRetailerStageAction(source, products), {
    stage: "data", action: "done", blocked: false, reason: "",
  });
  assert.equal(stripStates(source, products).badges, "done");
});

test("stage 4: identity mismatch advances to the next query", () => {
  const source = { store: "SSG", searchSubmitted: true, searchCompleted: true, identityRejectedCount: 2 };
  assert.deepEqual(nextRetailerStageAction(source, []), {
    stage: "identity", action: "try_next_query", blocked: true, reason: "product_identity_mismatch",
  });
  assert.equal(stripStates(source).identity, "blocked");
});

test("stage 4: an authoritative empty completes without stock collection", () => {
  const source = { store: "롯데온", searchSubmitted: true, searchCompleted: true, absenceConfirmed: true, count: 0, countVerified: true };
  assert.deepEqual(nextRetailerStageAction(source, []), {
    stage: "identity", action: "done_empty", blocked: false, reason: "",
  });
  assert.equal(stripStates(source).identity, "done");
});

test("stage 5: a recognized product without stock evidence collects stock", () => {
  const source = { store: "무신사", searchSubmitted: true, searchCompleted: true, count: 1, countVerified: true };
  const products = [{ officialStoreVerified: true, articleNumberVerified: true }];
  assert.deepEqual(nextRetailerStageAction(source, products), {
    stage: "stock", action: "collect_stock", blocked: false, reason: "",
  });
  assert.equal(stripStates(source, products).identity, "done");
  assert.equal(stripStates(source, products).stock, "pending");
});

test("stage 6: a priced, stock-verified product is done and the strip agrees", () => {
  const source = { store: "무신사", searchSubmitted: true, searchCompleted: true, count: 1, countVerified: true };
  const products = [{ officialStoreVerified: true, articleNumberVerified: true, price: 81360, stockVerified: true }];
  assert.deepEqual(nextRetailerStageAction(source, products), {
    stage: "data", action: "done", blocked: false, reason: "",
  });
  assert.deepEqual(Object.values(stripStates(source, products)), ["done", "done", "done", "done", "done", "done"]);
});
