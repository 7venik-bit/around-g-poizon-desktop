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

// Login-nudge modals (e.g. adidas adiclub signup) are closed with their own X
// instead: credentials must never be touched. Only an explicit close control
// inside a login-flavoured modal dialog may be pressed.
export const NUDGE_DIALOG_SOURCES = [
  "로그인",
  "가입",
  "회원",
  "멤버십",
  "login",
  "sign\\s*-?\\s*up",
  "join\\s*(?:now|free)?",
];

export const NUDGE_CLOSE_GLYPH_SOURCES = ["^[×✕✖✗xX]$"];

export const NUDGE_CLOSE_WORD_SOURCES = ["^닫기$", "^닫음$", "^close$"];

const dialogPatterns = CONSENT_DIALOG_SOURCES.map((source) => new RegExp(source, "i"));
const acceptPatterns = CONSENT_ACCEPT_SOURCES.map((source) => new RegExp(source, "i"));
const nudgePatterns = NUDGE_DIALOG_SOURCES.map((source) => new RegExp(source, "i"));
const nudgeGlyphPatterns = NUDGE_CLOSE_GLYPH_SOURCES.map((source) => new RegExp(source, "i"));
const nudgeWordPatterns = NUDGE_CLOSE_WORD_SOURCES.map((source) => new RegExp(source, "i"));

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

export function isNudgeDialogText(text = "") {
  return nudgePatterns.some((pattern) => pattern.test(String(text || "")));
}

// A close control is an X glyph or an explicit close word. Login/submit
// wording (계속하기, 가입하기, ... 로그인) must never match here.
export function isNudgeCloseControl({ label = "", aria = "" } = {}) {
  const text = String(label || "").replace(/\s+/g, " ").trim();
  const hint = String(aria || "").replace(/\s+/g, " ").trim();
  if (text && nudgeGlyphPatterns.some((pattern) => pattern.test(text))) return true;
  const word = hint || text;
  return Boolean(word) && word.length <= 20
    && nudgeWordPatterns.some((pattern) => pattern.test(word));
}

// buttons: [{ label, aria, dialogText, modal }]. Returns the index of the X
// inside a login-flavoured modal dialog, or -1. Non-modal contexts and
// credential/submit buttons are never returned.
export function findNudgeCloseButton(buttons = []) {
  const list = Array.isArray(buttons) ? buttons : [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index] || {};
    if (entry.modal !== true) continue;
    if (!isNudgeDialogText(entry.dialogText)) continue;
    if (!isNudgeCloseControl({ label: entry.label, aria: entry.aria })) continue;
    return index;
  }
  return -1;
}

// buttons: [{ label, aria, modal }]. Returns the index of the X/닫기 control
// inside ANY modal dialog, or -1. A site-provided close control only ever
// dismisses its own modal, so login flavour is not required. Credential and
// submit buttons can never match a close pattern (see isNudgeCloseControl).
export function findModalCloseButton(buttons = []) {
  const list = Array.isArray(buttons) ? buttons : [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index] || {};
    if (entry.modal !== true) continue;
    if (!isNudgeCloseControl({ label: entry.label, aria: entry.aria })) continue;
    return index;
  }
  return -1;
}
