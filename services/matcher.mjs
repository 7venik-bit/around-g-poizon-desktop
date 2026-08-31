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
