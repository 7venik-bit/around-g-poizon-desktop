(() => {
  if (globalThis.AroundGDomesticVerdict) return;

  const finiteCount = (value) => {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : null;
  };

  const failureLabels = Object.freeze({
    naver_shopping_click_failed: "네이버 쇼핑 진입 실패",
    fashion_town_click_failed: "패션타운 진입 실패",
    search_submission_failed: "검색 실행 확인 실패",
    result_parse_failed: "검색 결과 판독 실패",
    result_script_failed: "상품 수집 코드 실행 오류",
    result_analysis_failed: "검색 결과 분석 실패",
    page_load_timeout: "검색 페이지 응답 지연",
    collection_stalled: "상품·재고 확인 지연 · 다시 가져오기 필요",
    service_unavailable: "판매처 서비스 응답 오류",
    rate_limited: "네이버 접속량 제한 · 조회 중지",
    naver_rate_limited: "네이버 접속량 제한 · 조회 중지",
    page_load_failed: "검색 페이지 연결 실패",
    network_error: "판매처 연결 실패",
    security_verification_required: "보안 확인 필요",
    login_required: "로그인 필요",
    channel_selection_failed: "판매 채널 선택 실패",
    channel_count_detection_failed: "결과 숫자 인식 실패",
    ssg_access_limited_deferred: "SSG 접속 제한 · 열기로 직접 확인",
    overview_channel_card_collection_failed: "결과 카드 수집 실패",
    ssg_channel_evidence_mismatch: "SSG 결과 판독 실패",
    search_query_missing: "검색어 누락",
    naver_result_not_settled: "네이버 결과 대기 중",
    naver_seller_evidence_failed: "네이버 판매처 확인 실패",
    unknown_search_failure: "검색 처리 실패",
    chrome_not_found: "Chrome 설치 필요",
    chrome_launch_failed: "외부 로그인 실행 실패",
    cdp_unreachable: "외부 로그인 연결 실패",
    login_page_unreadable: "로그인 화면 인식 실패",
    login_blocked: "판매처 보안 차단 · 직접 확인",
    login_timeout: "외부 로그인 시간 초과",
    login_canceled: "로그인 중단",
  });

  const sourceVerdict = (source = {}, matchedProducts = []) => {
    const products = Array.isArray(matchedProducts) ? matchedProducts.filter(Boolean) : [];
    const count = finiteCount(source?.count);
    const observedCount = Math.max(products.length, count || 0);

    // Product evidence is the strongest signal. A parser/status error recorded
    // during the same search must never overwrite a visible exact result.
    const productExists = products.length > 0
      || source?.presenceConfirmed === true
      || source?.exactProductPresenceConfirmed === true
      || source?.naverTrustedChannelEvidence === true
      || source?.naverAllSearchVerdict === "confirmed"
      || (source?.countVerified === true && count > 0)
      || (source?.searchCompleted === true && count > 0);
    if (productExists) {
      return {
        state: "available",
        className: "available",
        count: observedCount,
        label: observedCount > 0 ? `상품 있음 · ${observedCount.toLocaleString("ko-KR")}개` : "상품 있음",
      };
    }

    const productAbsent = source?.absenceConfirmed === true
      || source?.naverAllSearchVerdict === "absent"
      || (source?.countVerified === true && count === 0)
      || (source?.searchCompleted === true && count === 0
        && Number(source?.candidateCount || 0) === 0
        && source?.verificationFailed !== true
        && source?.verificationPending !== true);
    if (productAbsent) {
      return { state: "missing", className: "missing", count: 0,
        label: source.identityRejectedCount > 0 ? "일치 상품 없음" : "상품 없음" };
    }

    // A confirmed zero is stronger than the link-only display mode. Previously
    // Naver Fashion Town and official-mall rows kept saying "검색 결과 링크"
    // even after the source had explicitly confirmed that no product exists.
    if (source?.resultLinkOnly === true) {
      return { state: "link", className: "available", count: 0, label: "검색 결과 링크" };
    }

    // Official-mall search is intentionally list/price only. When no card was
    // parsed, keep the usable result link instead of exposing parser/submission
    // diagnostics to the user. Only the mall's explicit empty message is absence.
    if (String(source?.store || "") === "브랜드 공식몰") {
      return { state: "link", className: "available", count: 0, label: "검색 결과" };
    }

    const loginErrorCode = String(source?.errorCode || source?.verificationDiagnostics?.errorCode || "");
    if (source?.rateLimited || loginErrorCode === "NAVER_RATE_LIMITED") {
      return {state:"failed",className:"pending",count:0,label:failureLabels.rate_limited};
    }
    if (loginErrorCode === "NAVER_CREDENTIALS_UNREADABLE") {
      return { state: "login", className: "pending", count: 0, label: "네이버 비밀번호 다시 저장 필요" };
    }
    if (loginErrorCode === "NAVER_CREDENTIALS_REQUIRED") {
      return { state: "login", className: "pending", count: 0, label: "네이버 계정 저장 필요" };
    }
    if (loginErrorCode === "NAVER_LOGIN_INPUTS_NOT_FOUND") {
      return { state: "login", className: "pending", count: 0, label: "로그인 화면 인식 오류" };
    }
    if (loginErrorCode === "NAVER_LOGIN_WINDOW_CLOSED") {
      return { state: "login", className: "pending", count: 0, label: "로그인 중단" };
    }
    if (["NAVER_LOGIN_URL_INVALID", "NAVER_LOGIN_PAGE_NOT_CONFIRMED"].includes(loginErrorCode)) {
      return { state: "login", className: "pending", count: 0, label: "로그인 연결 오류" };
    }
    if (/^SSG(?:\s|$)/.test(String(source?.store || ""))
      && (source?.securityVerificationRequired === true
        || String(source?.verificationReason || "") === "ssg_access_limited_deferred")) {
      return { state: "security", className: "pending", count: 0, label: "SSG 접속 제한 · 열기로 직접 확인" };
    }
    if (source?.securityVerificationRequired === true || loginErrorCode === "NAVER_VERIFICATION_REQUIRED") {
      return { state: "security", className: "pending", count: 0, label: "보안 확인 필요" };
    }
    if (source?.loginRequired === true) {
      return { state: "login", className: "pending", count: 0, label: "로그인 필요" };
    }

    if (source?.verificationFailed === true) {
      const reason = String(source?.verificationReason || "unknown_search_failure");
      const stage = String(source?.verificationStage || source?.verificationDiagnostics?.stage || "unknown");
      return {
        state: "failed",
        className: "pending",
        count: 0,
        // Internal collector codes remain available in the collapsed
        // diagnostics, but the product row shows only an actionable Korean
        // status. Raw codes confused a recoverable delay with product absence.
        label: failureLabels[reason] || "기술 오류",
        reason,
        stage,
        diagnostics: source?.verificationDiagnostics || null,
      };
    }
    if (source?.verificationPending === true) {
      return { state: "pending", className: "pending", count: 0, label: "확인 중" };
    }
    return { state: "pending", className: "pending", count: 0, label: "검색 전" };
  };

  const resultPresentation = (result) => {
    if (result?.accessLimitedUntil) return { label: "내일 재시도", className: "pending" };
    if (result?.loading) return { label: "검색 중…", className: "loading" };
    if (result?.error) return { label: "검색 실패", className: "error" };
    if (!result) return { label: "국내 검색", className: "pending" };

    const products = Array.isArray(result?.products) ? result.products.filter(Boolean) : [];
    if (products.length > 0) {
      return { label: `상품 ${products.length.toLocaleString("ko-KR")}개`, className: "available" };
    }

    const verdicts = (Array.isArray(result?.sources) ? result.sources : [])
      .map((source) => sourceVerdict(source, []));
    const availableCount = verdicts
      .filter((verdict) => verdict.state === "available")
      .reduce((sum, verdict) => sum + Number(verdict.count || 0), 0);
    if (verdicts.some((verdict) => verdict.state === "available")) {
      return {
        label: availableCount > 0 ? `결과 ${availableCount.toLocaleString("ko-KR")}개` : "상품 있음",
        className: "available",
      };
    }
    if (verdicts.some((verdict) => verdict.state === "link")) {
      return { label: "검색 결과 링크", className: "available" };
    }
    if (verdicts.some((verdict) => ["security", "login", "failed", "pending"].includes(verdict.state))) {
      return { label: "확인 필요", className: "pending" };
    }
    return { label: "상품 없음", className: "missing" };
  };

  // Six-stage pipeline progress in the operator's flow language:
  // 로그인 → 상품검색 → 로고확인 → 상품인식 → 재고확인 → 데이터.
  // Each step reports done/active/blocked/pending from the same source flags
  // the verdict uses, so the strip never contradicts the row status.
  const searchStepProgress = (source = {}, matchedProducts = []) => {
    const products = Array.isArray(matchedProducts) ? matchedProducts.filter(Boolean) : [];
    const searched = Boolean(source?.searchSubmitted || source?.searchCompleted
      || source?.countVerified || source?.absenceConfirmed || source?.presenceConfirmed
      || products.length > 0);
    const submissionBlocked = /^(search_query_missing|search_submission_failed|page_load_failed|page_load_timeout|network_error)$/
      .test(String(source?.verificationReason || ""));
    const searchDone = Boolean(source?.searchCompleted || source?.countVerified
      || source?.absenceConfirmed || products.length > 0);
    const searchActive = Boolean(source?.verificationPending || source?.detailVerificationPending)
      && !searchDone;
    // Stage 3 admits official and department-store logos only. Parallel
    // importers print the same brand names, so a bare brand-name match
    // (brandVerifiedFromCard) must never pass the logo gate.
    const brandEvidence = products.some((product) => product?.officialStoreVerified === true
      || product?.departmentStoreLabelMatched === true
      || product?.naverTrustedChannelEvidence === true)
      || source?.naverTrustedChannelEvidence === true;
    const recognized = products.length > 0
      || source?.presenceConfirmed === true || source?.exactProductPresenceConfirmed === true
      || (source?.searchCompleted === true && (finiteCount(source?.count) || 0) > 0);
    const mismatch = products.length === 0 && Number(source?.identityRejectedCount || 0) > 0;
    const authoritativeEmpty = products.length === 0 && (source?.absenceConfirmed === true
      || source?.naverAllSearchVerdict === "absent"
      || (source?.countVerified === true && finiteCount(source?.count) === 0));
    const stockKnown = products.some((product) => product?.stockVerified === true
      || product?.stockCoverage === "known" || Number(product?.price || 0) > 0);
    const stockActive = Boolean(source?.detailVerificationPending)
      || Number(source?.failedDetails || 0) > 0 && products.length > 0;
    const hasPricedData = products.some((product) => Number(product?.price || 0) > 0);
    const failed = source?.verificationFailed === true || source?.rateLimited === true;
    return [
      {
        key: "login",
        label: "로그인",
        state: source?.loginRequired === true ? "blocked"
          : searched ? "done" : "pending",
      },
      {
        key: "search",
        label: "상품검색",
        state: submissionBlocked || (failed && !searchDone) ? "blocked"
          : searchDone ? "done" : searchActive ? "active" : "pending",
      },
      {
        key: "badges",
        label: "로고확인",
        state: brandEvidence ? "done" : "pending",
      },
      {
        key: "identity",
        label: "상품인식",
        state: recognized ? "done"
          : mismatch ? "blocked" : authoritativeEmpty ? "done" : "pending",
      },
      {
        key: "stock",
        label: "재고확인",
        state: stockKnown ? "done" : stockActive ? "active" : "pending",
      },
      {
        key: "data",
        label: "데이터",
        state: hasPricedData ? "done" : failed && !recognized ? "blocked" : "pending",
      },
    ];
  };

  globalThis.AroundGDomesticVerdict = Object.freeze({ sourceVerdict, resultPresentation, searchStepProgress });
})();
