function normalized(value) {
  return String(value || "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function tokens(value) {
  return new Set(String(value || "").toLowerCase().match(/[0-9a-z가-힣]{2,}/g) || []);
}

function tokenSimilarity(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

export function imageEvidenceAllowsExactProduct({
  store = "",
  hasSourceImage = false,
  candidateImageUrl = "",
  imageCompared = false,
  imageScore = null,
  minimumScore = 58,
} = {}) {
  // Exact article number remains the primary identity. For SSG/Lotte, when
  // both images were actually compared, use the image as a secondary veto
  // against an obviously different colourway/model. Missing or unfetchable
  // images never become a false product-absence verdict.
  const portalNeedsImageGate = /^(?:SSG|롯데)/.test(String(store || ""));
  if (!portalNeedsImageGate || !hasSourceImage || !candidateImageUrl || imageCompared !== true) return true;
  const score = Number(imageScore);
  if (!Number.isFinite(score)) return true;
  return score >= Number(minimumScore || 58);
}

export function scoreProductCandidate(source, candidate, imageSimilarity = null) {
  const code = normalized(source.articleNumber);
  const identityText = [candidate.detectedArticleNumber, candidate.name, candidate.title]
    .filter(Boolean).join(" ");
  const exactCodePattern = source.articleNumber
    ? new RegExp(`(?:^|[^A-Z0-9])${String(source.articleNumber).toUpperCase().split(/[^A-Z0-9]+/)
      .filter(Boolean).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[-_\\s./]+")}(?=$|[^A-Z0-9])`, "i")
    : null;
  const detectedCode = normalized(candidate.detectedArticleNumber);
  const productOwnedText = [candidate.name, candidate.title].filter(Boolean).join(" ");
  // Marketplace URL IDs and internal result IDs are not manufacturer article
  // numbers. Only a verified detected code or the product-owned name/title can
  // satisfy the primary code gate.
  const codeScore = code && (detectedCode === code || exactCodePattern?.test(productOwnedText)) ? 1 : 0;
  const candidateCodes = [...new Set((identityText.toUpperCase().match(/[A-Z0-9]+(?:[-_][A-Z0-9]+)*/g) || [])
    .map((token) => token.replace(/[^A-Z0-9]/g, ""))
    .filter((token) => token.length >= 6 && token.length <= 28 && /[A-Z]/.test(token) && /\d/.test(token)))];
  const codeConflict = Boolean(code && candidateCodes.some((candidateCode) => candidateCode !== code.toUpperCase()));
  const titleScore = tokenSimilarity(
    [source.brand, source.title, source.articleNumber].filter(Boolean).join(" "),
    [candidate.brand, candidate.name, candidate.title, candidate.id].filter(Boolean).join(" "),
  );
  const imageScore = Number.isFinite(imageSimilarity)
    ? Math.max(0, Math.min(1, imageSimilarity))
    : null;
  const confidence = Math.round(
    codeScore * 55
    + titleScore * 30
    + (imageScore ?? 0) * 15,
  );
  return {
    confidence,
    signals: {
      code: codeScore === 1 ? "일치" : "불일치",
      codeConflict,
      detectedCodes: candidateCodes,
      title: titleScore >= 0.7 ? "높음" : titleScore >= 0.35 ? "보통" : "낮음",
      image: imageScore === null ? "확인 불가" : imageScore >= 0.82 ? "높음" : imageScore >= 0.58 ? "보통" : "낮음",
      codeScore,
      titleScore: Math.round(titleScore * 100),
      imageScore: imageScore === null ? null : Math.round(imageScore * 100),
    },
  };
}

const belongsToSource = (product, source) =>
  String(product?.sourceStore || product?.store || "") === String(source?.store || "");

// Counts and the source-level shortcut must refer to the same surviving items.
// In particular, linkOnly describes presentation, not an exemption from matching.
export function reconcileMatchedSources(sources = [], candidates = [], products = []) {
  return sources.map(source => {
    const before = candidates.filter(product => belongsToSource(product, source));
    if (!before.length && source.identityChecked !== true) return source;
    const matched = products.filter(product => belongsToSource(product, source));
    const present = matched.length > 0;
    return {
      ...source,
      identityChecked: true,
      count: matched.length,
      countVerified: present || source.absenceConfirmed === true,
      presenceConfirmed: present,
      exactProductPresenceConfirmed: present && matched.some(p => p.articleNumberVerified === true),
      naverTrustedChannelEvidence: present && source.naverTrustedChannelEvidence === true,
      naverAllSearchVerdict: present ? "confirmed" : source.absenceConfirmed === true ? "absent" : "pending",
      verifiedProductUrl: String(matched.find(p => /^https?:\/\//i.test(String(p.url || "")))?.url || ""),
      resultLinkOnly: false,
      ...(!present && source.absenceConfirmed !== true ? {verificationPending: true, searchCompleted: false} : {}),
    };
  });
}

// Run after comparison, before deciding whether a query has succeeded. A known
// mismatch is a reason to try the next distinct query; an access/load failure is not.
export function reconcileSearchAttempt(result = {}, products = []) {
  const candidates = Array.isArray(result.products) ? result.products : [];
  if (!candidates.length) return result;
  const accepted = new Set(products.map(p => p.url));
  const rejected = candidates.filter(p => !accepted.has(p.url));
  const blocked = result.rateLimited || result.loginRequired || result.securityVerificationRequired
    || result.verificationFailed || Number(result.verificationDiagnostics?.sellerFailedCount || 0) > 0
    || /(?:failed|error|timeout|stalled|canceled|rate_limit|login|security)/i.test(String(result.verificationReason || ""));
  const mismatch = !products.length && rejected.length > 0 && !blocked;
  return {
    ...result, products, identityChecked: true,
    count: products.length || (mismatch ? 0 : null),
    presenceConfirmed: products.length > 0,
    exactProductPresenceConfirmed: products.some(p => p.articleNumberVerified === true),
    naverTrustedChannelEvidence: products.some(p => p.naverTrustedChannelEvidence === true),
    naverAllSearchVerdict: products.length ? "confirmed" : mismatch ? "absent" : "pending",
    verifiedProductUrl: String(products[0]?.url || ""),
    rejectedProductUrls: [...new Set([...(result.rejectedProductUrls || []), ...rejected.map(p => p.url).filter(Boolean)])],
    identityRejectedCount: Number(result.identityRejectedCount || 0) + rejected.length,
    ...(mismatch ? {
      absenceConfirmed: true, searchCompleted: true, resultLinkOnly: false,
      verificationPending: false, detailVerificationPending: false,
      verificationReason: "product_identity_mismatch",
    } : !products.length ? {absenceConfirmed: false, verificationPending: true} : {}),
  };
}
