// Cookie/privacy consent overlays cover official-mall search inputs (observed
// 2026-10-10 on adidas.co.kr: "쿠키를 통한 아디다스 맞춤형 서비스 제공 관련
// 안내" with a "모두 동의합니다" button). Automation typing/clicking behind the
// overlay never submits the search, so a real product ends as "확인 필요".
// Pattern sources below are the single truth: pure matchers use them here,
// and main.mjs embeds the same sources into the page-side dismissal script
// (page scripts must stay self-contained for executeJavaScript).
export const CONSENT_DIALOG_SOURCES = [
  "쿠키",
  "개인정보",
  "맞춤형\\s*(?:서비스|광고)",
  "개인정보\\s*처리\\s*방침",
  "개인\\s*정보\\s*수집",
  "cookie",
  "privacy",
  "consent",
];

export const CONSENT_ACCEPT_SOURCES = [
  "^모두\\s*동의(?:합니다)?$",
  "^동의(?:합니다|함)?$",
  "^확인$",
  "^닫기$",
  "^닫음$",
  "^accept(?:\\s*all)?$",
  "^agree$",
  "^confirm$",
  "^close$",
  "모두\\s*동의",
];

const dialogPatterns = CONSENT_DIALOG_SOURCES.map((source) => new RegExp(source, "i"));
const acceptPatterns = CONSENT_ACCEPT_SOURCES.map((source) => new RegExp(source, "i"));

export function isConsentDialogText(text = "") {
  return dialogPatterns.some((pattern) => pattern.test(String(text || "")));
}

export function isConsentAcceptLabel(label = "") {
  const normalized = String(label || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 40) return false;
  return acceptPatterns.some((pattern) => pattern.test(normalized));
}

// buttons: [{ label, dialogText }]. Returns the index to press, or -1.
// A button is pressed only when its own dialog looks like consent AND its
// label is an explicit accept/close action. Never guess on generic pages.
export function findConsentAcceptButton(buttons = []) {
  const list = Array.isArray(buttons) ? buttons : [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index] || {};
    if (!isConsentDialogText(entry.dialogText)) continue;
    if (!isConsentAcceptLabel(entry.label)) continue;
    return index;
  }
  return -1;
}
