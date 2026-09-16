// Only the application's existing persistent Electron session is reused.
// No browser-password database, Windows credential enumeration or cookie export.
export function isNaverCommerceUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
      && ['shopping.naver.com', 'm.shopping.naver.com', 'brand.naver.com', 'smartstore.naver.com'].includes(url.hostname);
  } catch { return false; }
}

// Serialized in a trusted Naver frame; return state only, never input values.
export function captureNaverLoginState() {
  const url = new URL(location.href);
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const loginRequired = url.protocol === 'https:' && url.hostname === 'nid.naver.com';
  const form = document.querySelector('form');
  const password = [...document.querySelectorAll('input[type="password"]')].find(visible);
  const user = [...document.querySelectorAll('input')].find(el => visible(el) && el.type !== 'password'
    && /^(?:id|username|email)$/.test(el.id || el.name || el.autocomplete));
  const text = String(form?.innerText || document.body?.innerText || '').slice(0, 20000);
  const challenge = [...document.querySelectorAll('input')].some(el => visible(el)
    && /captcha|one-time-code|otp|인증번호/i.test([el.id,el.name,el.autocomplete,el.placeholder].join(' ')))
    || /자동\s*입력\s*방지|2단계\s*인증|본인\s*확인|기기\s*등록|비정상적인\s*접근|접속.{0,12}(?:제한|차단)/i.test(text);
  const credentialRejected = /아이디\s*(?:또는|나)\s*비밀번호.{0,40}(?:잘못|확인)|비밀번호가.{0,25}(?:틀|일치하지)|로그인에\s*실패/i.test(text);
  return {url:url.href, loginRequired, challenge, credentialRejected,
    formFound: Boolean(form && user && password),
    documentReady: document.readyState !== 'loading' && Boolean(document.body?.innerText?.trim())};
}

// All origin/form checks and the click run in one frame evaluation. This never
// calls form.submit() (which would bypass Naver's own validation/encryption).
export function submitSavedNaverLogin(credentials) {
  if (location.origin !== 'https://nid.naver.com'
    || location.pathname !== '/nidlogin.login') return {submitted:false, reason:'untrusted_login_page'};
  const visible = el => {
    const r=el.getBoundingClientRect(), s=getComputedStyle(el);
    return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden';
  };
  if ([...document.querySelectorAll('input')].some(el => visible(el)
    && /captcha|one-time-code|otp/i.test([el.id,el.name,el.autocomplete].join(' ')))) {
    return {submitted:false, reason:'manual_verification_required'};
  }
  const password = [...document.querySelectorAll('input[type="password"]')].find(visible);
  const form = password?.form;
  const user = [...(form?.querySelectorAll('input') || [])].find(el => visible(el) && el.type!=='password'
    && /^(?:id|username|email)$/.test(el.id || el.name || el.autocomplete));
  const button = [...(form?.querySelectorAll('button,input[type="submit"]') || [])].find(el => visible(el)
    && !el.disabled && /로그인|log\s*in/i.test(el.textContent || el.value || ''));
  if (!form || !user || !password || !button) return {submitted:false, reason:'login_form_not_ready'};
  const action = new URL(button.getAttribute('formaction') || form.action || location.href, location.href);
  const method = button.getAttribute('formmethod') || form.method;
  if (method.toLowerCase() !== 'post' || action.origin!=='https://nid.naver.com'
    || action.pathname!=='/nidlogin.login' || action.username || action.password) {
    return {submitted:false, reason:'untrusted_login_action'};
  }
  if (!credentials?.id || !credentials?.password) return {submitted:false, reason:'saved_credentials_missing'};
  // Do not overwrite a password being entered manually or another account.
  if (password.value || (user.value && user.value !== credentials.id)) return {submitted:false, reason:'manual_input_present'};
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  if (!setter) return {submitted:false, reason:'login_form_not_ready'};
  for (const [field,value] of [[user,credentials.id],[password,credentials.password]]) {
    setter.call(field,value);
    field.dispatchEvent(new Event('input',{bubbles:true}));
    field.dispatchEvent(new Event('change',{bubbles:true}));
  }
  button.click();
  return {submitted:true};
}

export class NaverLoginRecovery {
  constructor({createWindow, credentials, now=Date.now, wait=ms=>new Promise(r=>setTimeout(r,ms)), timeoutMs=60_000, notify=()=>{}}) {
    this.createWindow=createWindow; this.credentials=credentials; this.now=now; this.wait=wait;
    this.timeoutMs=Math.min(60_000, Math.max(1000,timeoutMs)); this.notify=notify;
    this.states=new WeakMap();
  }
  state(session) {
    if (!this.states.has(session)) this.states.set(session,{blocked:false,pending:null,revision:0,epoch:0,window:null,subscribers:new Set()});
    return this.states.get(session);
  }
  reset(session) { const s=this.state(session); s.epoch++; s.blocked=false; }
  observedManualLogin(session) { const s=this.state(session); s.revision++; s.blocked=false; }
  async ensure({session,targetUrl,canceled=()=>false}) {
    if (!isNaverCommerceUrl(targetUrl)) return {ok:false,reason:'invalid_naver_return_url'};
    if (canceled()) return {ok:false,reason:'search_canceled'};
    const state=this.state(session);
    if (!state.pending && state.blocked) return {ok:false,reason:'login_required'};
    const subscriber=()=>canceled();
    state.subscribers.add(subscriber);
    if (!state.pending) {
      let deadlineTimer;
      const task=Promise.race([
        this.run({session,targetUrl,canceled:()=>[...state.subscribers].every(stop=>stop()),state}),
        new Promise(resolve => {
          deadlineTimer=setTimeout(() => {
            state.epoch++; state.blocked=true;
            if (state.window && !state.window.isDestroyed()) state.window.show();
            resolve({ok:false,reason:'login_required'});
          },this.timeoutMs);
        }),
      ]);
      state.pending=task;
      void task.finally(()=>{clearTimeout(deadlineTimer);if(state.pending===task)state.pending=null;});
    }
    let cancelTimer;
    try {
      return await Promise.race([state.pending,new Promise(resolve=>{
        const check=()=>{if(canceled())resolve({ok:false,reason:'search_canceled'});else cancelTimer=setTimeout(check,100);};
        check();
      })]);
    } finally {clearTimeout(cancelTimer);state.subscribers.delete(subscriber);}
  }

  async run({session,targetUrl,canceled,state}) {
    const epoch=state.epoch, expires=this.now()+this.timeoutMs;
    const stopped=()=>canceled() || state.epoch!==epoch;
    let attempted=false, manualOnly=false, revision=state.revision;
    let win;
    try {
      win=await this.createWindow(session);
      state.window=win;
      if (stopped()) return {ok:false,reason:'search_canceled'};
      // Never await loadURL's full-resource completion; login DOM can be usable
      // while optional images remain pending, just like product documents.
      void win.loadURL('https://nid.naver.com/nidlogin.login?url='+encodeURIComponent(targetUrl)).catch(()=>{});
      this.notify({state:'restoring'});
      while (this.now()<expires) {
        if (stopped() || win.isDestroyed()) return {ok:false,reason:'search_canceled'};
        const observed=await win.webContents.mainFrame.executeJavaScript(`(${captureNaverLoginState.toString()})()`,true).catch(()=>null);
        if (stopped()) return {ok:false,reason:'search_canceled'};
        if (observed?.challenge) {
          manualOnly=true;
          win.show(); win.setTitle?.('네이버 추가 인증 · 완료하면 검색을 이어갑니다');
        } else if (observed?.credentialRejected) {
          state.blocked=true;
          win.show(); win.setTitle?.('네이버 계정 확인 필요 · 자동 로그인을 반복하지 않습니다');
          return {ok:false,reason:'login_required'};
        } else if (observed?.documentReady && !observed.loginRequired && isNaverCommerceUrl(observed.url)) {
          await session.cookies.flushStore();
          await session.flushStorageData();
          if (stopped()) return {ok:false,reason:'search_canceled'};
          state.blocked=false;
          this.notify({state:'restored'});
          return {ok:true};
        } else if (observed?.loginRequired && observed.formFound && !attempted && !manualOnly) {
          attempted=true; // at most one credential submission per recovery
          let saved;
          try { saved=await this.credentials(); } catch { saved=null; }
          if (stopped()) return {ok:false,reason:'search_canceled'};
          if (saved?.enabled && saved.id && saved.password) {
            const result=await win.webContents.mainFrame.executeJavaScript(
              `(${submitSavedNaverLogin.toString()})(${JSON.stringify({id:saved.id,password:saved.password})})`,true).catch(()=>null);
            saved=null;
            if (!result?.submitted) manualOnly=true;
          } else { saved=null; manualOnly=true; }
          if (manualOnly) {
            win.show(); win.setTitle?.('네이버 로그인 · 저장된 계정이 없으면 직접 로그인해 주세요');
          }
        }
        if (state.revision!==revision) {
          // Another Open/login window completed authentication in this exact
          // Electron session. Recheck the original target, not cookie count.
          revision=state.revision;
          void win.loadURL(targetUrl).catch(()=>{});
        }
        await this.wait(400);
      }
      state.blocked=true;
      win.show();
      return {ok:false,reason:manualOnly?'manual_verification_required':'login_required'};
    } catch {
      // Never include raw frame errors, account values or cookies in logs/UI.
      state.blocked=true;
      return {ok:false,reason:'login_required'};
    }
  }
}
