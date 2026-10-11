// Cookie/privacy consent overlays cover official-mall search inputs (observed
// 2026-10-10 on adidas.co.kr: "쿠키를 통한 아디다스 맞춤형 서비스 제공 관련
// 안내" with a "모두 동의합니다" button; observed 2026-10-11: the accept
// button lives in a nested actions div, so the closest div alone carries no
// consent wording and the dismissal missed it).
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
  "^[×x✕✖χ]$",
  "모두\\s*동의",
  "닫기",
];

const dialogPatterns = CONSENT_DIALOG_SOURCES.map((source) => new RegExp(source, "i"));
const acceptPatterns = CONSENT_ACCEPT_SOURCES.map((source) => new RegExp(source, "i"));

export function isConsentDialogText(text = "") {
  return dialogPatterns.some((pattern) => pattern.test(String(text || "")));
}

export function isConsentAcceptLabel(label = "") {
  // Adidas renders "모두 동의합니다 →" with a trailing arrow glyph. Strip
  // decorative arrows/chevrons so the anchored accept patterns still match.
  const normalized = String(label || "")
    .replace(/[→⟶➔➜➤▶▷›»〉❯]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

// The page-side dismissal climbs from the button through up to 8 ancestors
// because the closest div is often a narrow actions wrapper without consent
// wording (Adidas 2026-10-11). This pure helper mirrors that climb for tests:
// given the button's own text plus ancestor texts from nearest to farthest,
// return the first ancestor text that reads as a consent dialog.
export function resolveConsentDialogText(ancestorTexts = []) {
  const list = Array.isArray(ancestorTexts) ? ancestorTexts : [];
  for (const text of list) {
    if (isConsentDialogText(text)) return String(text || "");
  }
  return "";
}
