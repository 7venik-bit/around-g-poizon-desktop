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
    result_analysis_failed: "검색 결과 분석 실패",
    page_load_timeout: "검색 페이지 응답 지연",
    page_load_failed: "검색 페이지 연결 실패",
    network_error: "판매처 연결 실패",
    security_verification_required: "보안 확인 필요",
    login_required: "로그인 필요",
    channel_selection_failed: "판매 채널 선택 실패",
    channel_count_detection_failed: "결과 숫자 인식 실패",
    overview_channel_card_collection_failed: "결과 카드 수집 실패",
    ssg_channel_evidence_mismatch: "SSG 결과 판독 실패",
    search_query_missing: "검색어 누락",
    naver_result_not_settled: "네이버 결과 대기 중",
    unknown_search_failure: "검색 처리 실패",
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

    if (source?.resultLinkOnly === true) {
      return { state: "link", className: "available", count: 0, label: "검색 결과 링크" };
    }

    if (source?.securityVerificationRequired === true) {
      return { state: "security", className: "pending", count: 0, label: "보안 확인 필요" };
    }
    if (source?.loginRequired === true) {
      return { state: "login", className: "pending", count: 0, label: "로그인 필요" };
    }

    const productAbsent = source?.absenceConfirmed === true
      || source?.naverAllSearchVerdict === "absent"
      || (source?.countVerified === true && count === 0)
      || (source?.searchCompleted === true && count === 0
        && Number(source?.candidateCount || 0) === 0
        && source?.verificationPending !== true);
    if (productAbsent) {
      return { state: "missing", className: "missing", count: 0, label: "상품 없음" };
    }

    if (source?.verificationFailed === true) {
      const reason = String(source?.verificationReason || "unknown_search_failure");
      const stage = String(source?.verificationStage || source?.verificationDiagnostics?.stage || "unknown");
      return {
        state: "failed",
        className: "pending",
        count: 0,
        label: `${failureLabels[reason] || "기술 오류"} · ${reason}`,
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

  globalThis.AroundGDomesticVerdict = Object.freeze({ sourceVerdict, resultPresentation });
})();
