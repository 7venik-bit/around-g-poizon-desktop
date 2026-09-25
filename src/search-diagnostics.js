/* Local, user-triggered search diagnostics. No page contents or account data are stored. */
(() => {
  const STORAGE_KEY = "around-g-search-diagnostics-v1";
  const SUCCESS_CODES = new Set(["approved_domestic_seller", "복구 완료"]);
  const ABSENCE_CODES = new Set(["naver_explicit_empty", "naver_authoritative_zero", "overseas_direct_only"]);
  const ACCESS_CODES = new Set(["login_required", "security_verification_required", "rate_limited"]);
  const ISSUE_NAMES = {
    stock_unverified: "상품은 확인됨 · 재고 확인 필요",
    collection_incomplete: "검색 또는 상세 수집 미완료",
    search_failed: "상품 검색 실패",
    login_required: "판매처 로그인 필요",
    security_verification_required: "판매처 보안 확인 필요",
    rate_limited: "판매처 접속량 제한",
  };
  const shortCode = (value, fallback = "") => {
    const code = String(value || "").trim();
    return /^[\w.-]{1,80}$/.test(code) || code === "복구 완료" ? code : fallback;
  };
  const sourceOutcome = (source = {}) => {
    const reason = shortCode(source.verificationReason);
    const recovery = String(source.autoRecovery?.status || "");
    const accessCode = source.rateLimited ? "rate_limited"
      : source.securityVerificationRequired ? "security_verification_required"
        : source.loginRequired ? "login_required" : ACCESS_CODES.has(reason) ? reason : "";
    if (accessCode) return { code: accessCode, state: "open", action: accessCode === "rate_limited" ? "retry" : "login" };
    if (source.verificationFailed || source.verificationPending || source.detailVerificationPending
      || ["partial", "manual", "blocked"].includes(recovery)) {
      return { code: reason && !SUCCESS_CODES.has(reason) ? reason : "stock_unverified", state: "open", action: "retry" };
    }
    if (source.absenceConfirmed === true && source.searchCompleted === true) {
      return { code: reason || "authoritative_absence", state: "absent", action: "" };
    }
    if (reason && !SUCCESS_CODES.has(reason)) return { code: reason, state: "open", action: "retry" };
    if (recovery === "recovered" || reason === "복구 완료") return { code: "복구 완료", state: "recovered", action: "" };
    if (reason === "approved_domestic_seller") return { code: reason, state: "verified", action: "" };
    return null;
  };
  const safeLabel = (value, limit = 120) => String(value || "").replace(/[\x00-\x1f]/g, " ").trim().slice(0, limit);
  const describe = (entry) => ISSUE_NAMES[entry.code] || (entry.state === "absent" ? "검색 결과에서 상품 없음 확인" : entry.state === "verified" ? "국내 판매처·상품 확인" : entry.state === "recovered" ? "자동 복구 완료" : "확인 또는 재검색 필요");

  function createController({ document: doc = document, storage = localStorage, onAction = async () => {}, onOpen = () => {} } = {}) {
    const button = doc.getElementById("search-diagnostics-open");
    const dialog = doc.getElementById("search-diagnostics-dialog");
    const list = doc.getElementById("search-diagnostics-list");
    const summary = doc.getElementById("search-diagnostics-summary");
    let entries = [];
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) entries = saved.slice(0, 200).filter((item) => item?.id && item?.code)
        .map((item) => item.state === "open" && ABSENCE_CODES.has(item.code)
          ? {...item, state: "absent", action: ""} : item);
    } catch { /* Damaged diagnostics must not stop sourcing. */ }
    const save = () => {
      entries = entries.slice(0, 200);
      try { storage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* Storage may be full. */ }
      render();
    };
    const makeId = (scope, key, store, code) => JSON.stringify([scope, key, store, code]);
    const recordResult = (result = {}, product = {}, { scope = "excel", key = "", scan = false } = {}) => {
      if (!result || result.loading || !key) return;
      const article = safeLabel(product.articleNumber || product.productCode || product.spuId || key, 80);
      const brand = safeLabel(product.brand || product.brandName || "", 80);
      const sources = Array.isArray(result.sources) ? result.sources : [];
      const observations = sources.map((source) => ({
        store: safeLabel(source.store || "판매처", 80), source,
        outcome: sourceOutcome(source),
      })).filter((item) => item.outcome && item.outcome.state !== "absent");
      if (result.error) observations.push({ store: "국내 검색", outcome: {
        code: shortCode(result.error, "search_failed"), state: "open", action: "retry",
      } });
      else if (result.partial && !observations.some((item) => item.outcome.state === "open")) {
        observations.push({ store: "국내 검색", outcome: {code: "collection_incomplete", state: "open", action: "retry"} });
      }
      const now = new Date().toISOString();
      const settledStores = sources.filter((source) => {
        const outcome = sourceOutcome(source);
        return (!outcome || outcome.state === "absent")
          && (source.searchCompleted || source.absenceConfirmed || source.presenceConfirmed);
      })
        .map((source) => safeLabel(source.store || "판매처", 80));
      if (!result.error && !result.partial) settledStores.push("국내 검색");
      for (const old of entries) if (old.scope === scope && old.key === key && old.state === "open"
        && settledStores.includes(old.store)) {
        old.state = "resolved";
        old.resolvedAt = now;
      }
      if (!observations.length) { save(); return; }
      for (const {store, source, outcome} of observations) {
        // A later successful check closes earlier failures for the same product and retailer.
        if (outcome.state !== "open") for (const old of entries) {
          if (old.scope === scope && old.key === key && old.store === store && old.state === "open") {
            old.state = "resolved";
            old.resolvedAt = now;
          }
        }
        const id = makeId(scope, key, store, outcome.code);
        const previous = entries.find((item) => item.id === id);
        if (scan && previous) continue;
        const item = {
          id, scope, key, store, article, brand, code: outcome.code,
          stage: safeLabel(source?.verificationStage || source?.verificationDiagnostics?.stage || "", 80),
          state: outcome.state, action: outcome.action, firstSeenAt: previous?.firstSeenAt || now,
          lastSeenAt: now, count: (previous?.count || 0) + 1,
        };
        entries = [item, ...entries.filter((entry) => entry.id !== id)];
      }
      save();
    };
    const render = () => {
      const openCount = entries.filter((item) => item.state === "open").length;
      const badge = doc.getElementById("search-diagnostics-count");
      if (badge) { badge.textContent = String(openCount); badge.hidden = openCount === 0; }
      if (summary) summary.textContent = openCount
        ? `조치 필요 ${openCount}건 · 최근 진단 ${entries.length}건` : `조치 필요 없음 · 최근 진단 ${entries.length}건`;
      if (!list) return;
      list.replaceChildren();
      if (!entries.length) {
        const empty = doc.createElement("p"); empty.className = "empty";
        empty.textContent = "기록된 검색 진단이 없습니다. 상품을 검색하면 상태가 이곳에 저장됩니다.";
        list.append(empty); return;
      }
      for (const entry of entries) {
        const row = doc.createElement("article"); row.className = `search-diagnostics-item ${entry.state}`;
        const heading = doc.createElement("div"); heading.className = "search-diagnostics-item-head";
        const title = doc.createElement("strong"); title.textContent = `${entry.brand ? `${entry.brand} · ` : ""}${entry.article} · ${entry.store}`;
        const state = doc.createElement("span"); state.textContent = ({open:"조치 필요",absent:"상품 없음",verified:"확인 완료",recovered:"복구 완료",resolved:"해결됨"})[entry.state] || entry.state;
        heading.append(title, state);
        const detail = doc.createElement("p"); detail.textContent = describe(entry);
        const meta = doc.createElement("small"); meta.textContent = `코드 ${entry.code}${entry.stage ? ` · 단계 ${entry.stage}` : ""} · ${new Date(entry.lastSeenAt).toLocaleString("ko-KR")}`;
        row.append(heading, detail, meta);
        if (entry.state === "open" && entry.action) {
          const action = doc.createElement("button"); action.type = "button";
          action.dataset.diagnosticAction = entry.id;
          action.textContent = entry.action === "login" ? "로그인 확인"
            : entry.code === "rate_limited" ? "제한 해제 후 다시 검색" : "이 상품 다시 검색";
          row.append(action);
        }
        list.append(row);
      }
    };
    button?.addEventListener("click", () => { onOpen(); render(); dialog?.showModal(); });
    doc.getElementById("search-diagnostics-close")?.addEventListener("click", () => dialog?.close());
    doc.getElementById("search-diagnostics-copy")?.addEventListener("click", async () => {
      const status = doc.getElementById("search-diagnostics-action-status");
      const report = entries.map((entry) => [entry.lastSeenAt, entry.state, entry.brand, entry.article,
        entry.store, entry.code, entry.stage].join(" | ")).join("\n");
      try {
        if (globalThis.aroundG?.copyDiagnostics) await globalThis.aroundG.copyDiagnostics(report || "검색 진단 기록 없음");
        else await globalThis.navigator.clipboard.writeText(report || "검색 진단 기록 없음");
        if (status) status.textContent = "진단 코드를 복사했습니다. 계정 정보와 페이지 내용은 포함되지 않습니다.";
      } catch {
        if (status) status.textContent = "클립보드에 복사하지 못했습니다.";
      }
    });
    list?.addEventListener("click", async (event) => {
      const id = event.target.closest("[data-diagnostic-action]")?.dataset.diagnosticAction;
      const entry = entries.find((item) => item.id === id);
      if (!entry) return;
      const status = doc.getElementById("search-diagnostics-action-status");
      try { await onAction(entry); if (status) status.textContent = "조치를 시작했습니다. 새 검색 결과가 들어오면 상태가 갱신됩니다."; }
      catch (error) { if (status) status.textContent = `조치를 시작하지 못했습니다: ${safeLabel(error?.message || error)}`; }
    });
    render();
    return {recordResult, entries: () => entries.map((entry) => ({...entry})), render};
  }
  globalThis.AroundGSearchDiagnostics = {sourceOutcome, createController};
})();
