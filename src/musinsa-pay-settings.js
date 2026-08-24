(() => {
  function mount() {
    const settingsView = document.getElementById("settings");
    if (!settingsView || document.getElementById("musinsa-pay-security")) return;

    const panel = document.createElement("section");
    panel.id = "musinsa-pay-security";
    panel.className = "panel";
    panel.innerHTML = `
      <small>PAYMENT SECURITY</small>
      <h2>무신사페이 자동구매 보안</h2>
      <p class="musinsa-pay-copy">결제 비밀번호는 Windows 계정 기반 암호화 저장소에 보관합니다. 저장된 비밀번호 원문은 화면에 다시 표시하지 않습니다.</p>
      <div class="musinsa-pay-row">
        <label for="musinsa-pay-password">결제 비밀번호</label>
        <input id="musinsa-pay-password" type="password" inputmode="numeric" autocomplete="new-password" placeholder="결제 비밀번호 입력" maxlength="64">
        <button id="musinsa-pay-save" type="button" class="primary">안전하게 저장</button>
        <button id="musinsa-pay-clear" type="button">삭제</button>
      </div>
      <div class="musinsa-pay-status" aria-live="polite">
        <strong id="musinsa-pay-state">상태 확인 중</strong>
        <span id="musinsa-pay-message">Windows 보안 저장소를 확인합니다.</span>
      </div>`;
    settingsView.appendChild(panel);

    const style = document.createElement("style");
    style.textContent = `
      #musinsa-pay-security{margin-top:18px}.musinsa-pay-copy{margin:8px 0 16px;color:#5c6675;line-height:1.6}
      .musinsa-pay-row{display:grid;grid-template-columns:120px minmax(180px,320px) auto auto;gap:10px;align-items:center}
      .musinsa-pay-row input{height:40px;border:1px solid #d7dce3;border-radius:9px;padding:0 12px;font:inherit}
      .musinsa-pay-row button{height:40px}.musinsa-pay-status{display:flex;gap:10px;align-items:center;margin-top:14px;padding:12px 14px;border-radius:10px;background:#f5f7fa}
      .musinsa-pay-status strong{min-width:76px}.musinsa-pay-status span{color:#5c6675}
      @media(max-width:900px){.musinsa-pay-row{grid-template-columns:1fr}.musinsa-pay-row label{font-weight:700}}
    `;
    document.head.appendChild(style);

    const input = document.getElementById("musinsa-pay-password");
    const save = document.getElementById("musinsa-pay-save");
    const clear = document.getElementById("musinsa-pay-clear");
    const state = document.getElementById("musinsa-pay-state");
    const message = document.getElementById("musinsa-pay-message");

    const render = (status = {}) => {
      if (!status.encryptionAvailable) {
        state.textContent = "사용 불가";
        message.textContent = "Windows 보안 저장소를 사용할 수 없습니다.";
        save.disabled = true;
        return;
      }
      save.disabled = false;
      state.textContent = status.configured ? "등록됨" : "미등록";
      message.textContent = status.configured
        ? "결제 비밀번호가 Windows 보안 저장소에 암호화되어 있습니다."
        : "자동구매 전에 결제 비밀번호를 등록하세요.";
      clear.disabled = !status.configured;
    };

    const refresh = async () => {
      try { render(await window.aroundG.getMusinsaPayStatus()); }
      catch { state.textContent = "확인 실패"; message.textContent = "결제 보안 상태를 읽지 못했습니다."; }
    };

    save.addEventListener("click", async () => {
      const password = input.value.trim();
      if (!password) { message.textContent = "결제 비밀번호를 입력하세요."; input.focus(); return; }
      save.disabled = true;
      const result = await window.aroundG.saveMusinsaPayPassword(password).catch((error) => ({ ok: false, message: String(error) }));
      input.value = "";
      if (!result?.ok) { state.textContent = "저장 실패"; message.textContent = result?.message || "결제 비밀번호를 저장하지 못했습니다."; save.disabled = false; return; }
      render(result);
    });

    clear.addEventListener("click", async () => {
      clear.disabled = true;
      const result = await window.aroundG.clearMusinsaPayPassword().catch((error) => ({ ok: false, message: String(error) }));
      if (!result?.ok) { state.textContent = "삭제 실패"; message.textContent = result?.message || "저장된 결제 비밀번호를 삭제하지 못했습니다."; clear.disabled = false; return; }
      render(result);
    });

    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
