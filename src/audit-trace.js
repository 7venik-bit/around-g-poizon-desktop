(function (root) {
  const MAX_LINES = 240;

  function createAuditTraceController(doc = root.document, clock = () => new Date()) {
    const panel = doc.getElementById("audit-trace-panel");
    const title = doc.getElementById("audit-trace-title");
    const summary = doc.getElementById("audit-trace-summary");
    const output = doc.getElementById("audit-trace-output");
    const close = doc.getElementById("audit-trace-close");
    if (!panel || !title || !summary || !output || !close) return null;

    let activeKind = "";
    let lastEvent = "";
    const timeLabel = () => clock().toLocaleTimeString("ko-KR", { hour12: false });
    const follow = () => {
      const scroll = () => {
        if (typeof output.scrollTo === "function") {
          output.scrollTo({ top: output.scrollHeight, behavior: "smooth" });
        } else {
          output.scrollTop = output.scrollHeight;
        }
      };
      if (typeof root.requestAnimationFrame === "function") root.requestAnimationFrame(scroll);
      else scroll();
    };
    const append = (kind, message, tone = "info") => {
      if (activeKind !== kind || panel.hidden) return;
      const line = doc.createElement("div");
      line.className = `audit-trace-line ${tone}`;
      line.textContent = `[${timeLabel()}] ${message}`;
      output.append(line);
      while (output.childElementCount > MAX_LINES) output.firstElementChild.remove();
      follow();
    };
    const open = (kind) => {
      activeKind = kind;
      lastEvent = "";
      output.replaceChildren();
      panel.hidden = false;
      panel.dataset.kind = kind;
      title.textContent = kind === "official" ? "공식몰 점검 · 실시간 실행 로그" : "서버 점검 · 실시간 실행 로그";
      summary.textContent = "실제 점검 단계와 응답이 아래에 기록됩니다.";
      append(kind, kind === "official"
        ? "await auditOfficialStores({ scope: '전체 브랜드' });"
        : "await checkSiteHealth({ targets: 9 });");
    };
    const official = (audit = {}) => {
      if (activeKind !== "official" || panel.hidden) return;
      const processed = Number(audit.processed || 0);
      const total = Number(audit.runTotal || 0);
      const brand = String(audit.currentBrand || "");
      const phase = String(audit.phase || "");
      const detail = String(audit.detail || "");
      const state = String(audit.state || "");
      const key = [audit.startedAt, brand, processed, phase, detail, audit.attempt, state, audit.running].join("|");
      if (key === lastEvent) return;
      lastEvent = key;
      summary.textContent = total
        ? `${processed.toLocaleString("ko-KR")}/${total.toLocaleString("ko-KR")}개 브랜드 점검${brand ? ` · ${brand}` : ""}`
        : "공식몰 점검을 준비하고 있습니다.";
      if (audit.running && brand) {
        const quotedBrand = JSON.stringify(brand);
        const commands = {
          starting: `brand = ${quotedBrand}; await inspectBrand(brand);`,
          retrying: `await retryBrand(${quotedBrand});`,
          naver_search: `await findOfficialHomepage(${quotedBrand});`,
          logo_compare: `await compareBrandLogos(${quotedBrand});`,
          official_site: `await verifyOfficialPage(${quotedBrand});`,
          adapter_linkage: `await checkStoreAdapter(${quotedBrand});`,
          saved: `saveResult(${quotedBrand}, ${JSON.stringify(String(audit.updatedBrand?.status || "확인 중"))}); // ${processed}/${total}`,
          timed_out: `timeout(${quotedBrand}); // 다음 브랜드로 이동`,
          security_wait: `pause(${quotedBrand}); // 보안 확인 필요`,
        };
        const command = commands[phase];
        if (command) append("official", detail ? `${command} // ${detail}` : command,
          phase === "security_wait" || phase === "timed_out" ? "warn" : phase === "saved" ? "success" : "info");
      } else if (!audit.running && ["paused", "completed", "completed_with_pending", "failed"].includes(state)) {
        append("official", `auditOfficialStores.finish({ state: ${JSON.stringify(state)}, processed: ${processed}, total: ${total} });`,
          state === "completed" ? "success" : "warn");
        summary.textContent = `${summary.textContent} · ${state === "completed" ? "완료" : state === "paused" ? "일시 중지" : "추가 확인 필요"}`;
      }
    };
    const server = (health = {}) => {
      if (activeKind !== "server" || panel.hidden) return;
      const completed = Number(health.completed || 0);
      const total = Number(health.total || 0);
      const target = health.currentTarget || {};
      const result = health.lastResult || {};
      const key = [health.startedAt, completed, target.id, result.id, result.statusCode,
        result.responseMs, health.state, health.running].join("|");
      if (key === lastEvent) return;
      lastEvent = key;
      if (total) summary.textContent = `${completed}/${total}개 사이트 응답 확인`;
      if (result.id) {
        const status = result.statusCode ? `HTTP ${result.statusCode}` : String(result.error || "연결 실패");
        append("server", `response(${JSON.stringify(result.name)}) => ${status} · ${result.responseMs}ms · ${result.result}`,
          result.ok ? "success" : "warn");
      } else if (health.running && target.id) {
        append("server", `await fetch(${JSON.stringify(target.url)}); // ${target.name}`);
      }
      if (!health.running && ["completed", "completed_with_errors", "failed"].includes(health.state)) {
        append("server", `checkSiteHealth.finish({ passed: ${Number(health.passed || 0)}, failed: ${Number(health.failed || 0)} });`,
          health.state === "completed" ? "success" : "warn");
        if (health.reportPath) append("server", `report.saved(${JSON.stringify(health.reportPath)});`, "success");
        summary.textContent = `${Number(health.passed || 0)}개 응답 · ${Number(health.failed || 0)}개 확인 필요`;
      }
    };
    close.addEventListener("click", () => { panel.hidden = true; });
    return { open, append, official, server, close: () => { panel.hidden = true; } };
  }

  root.AroundGAuditTrace = Object.freeze({ createAuditTraceController });
})(globalThis);
