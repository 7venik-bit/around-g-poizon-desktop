// Account data stays in the main process. Only IDs and saved/error flags are
// exposed to the settings view; passwords are never sent back to the renderer.
export const SHOPPING_LOGIN_METHODS = ['password', 'naver', 'kakao'];
const LEGACY = new Set(['naver', 'nike', 'adidas']);

export function shoppingLoginHostAllowed(value, domains = []) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
  } catch { return false; }
}

export class ShoppingAccounts {
  constructor({ store, sources, encrypt, decrypt, onChanged = async () => {} }) {
    Object.assign(this, { store, sources, encrypt, decrypt, onChanged });
    this.queue = Promise.resolve();
  }
  source(id) { return this.sources.find(source => source.id === id); }
  record(id) {
    const settings = this.store.snapshot().settings;
    const saved = settings.shoppingAccounts?.[id] || {};
    return LEGACY.has(id) ? { ...saved, loginId:settings[`${id}LoginId`] || '',
      passwordEncrypted:settings[`${id}PasswordEncrypted`] || '' } : saved;
  }
  credentials(id) {
    const record = this.record(id);
    try {
      const loginId = record.idEncrypted ? this.decrypt(record.idEncrypted) : record.loginId || '';
      const password = record.passwordEncrypted ? this.decrypt(record.passwordEncrypted) : '';
      return { loginId, password, code:loginId && password ? '' : 'ACCOUNT_CREDENTIALS_REQUIRED' };
    } catch { return {loginId:'',password:'',code:'ACCOUNT_CREDENTIALS_UNREADABLE'}; }
  }
  publicAccount(id) {
    const record = this.record(id), credentials = this.credentials(id);
    return { id, loginId:credentials.loginId, hasPassword:Boolean(record.passwordEncrypted),
      method:record.method || 'password', credentialCode:credentials.code,
      configured:Boolean(record.method || credentials.loginId || record.passwordEncrypted) };
  }
  save(input = {}) {
    const submitted = structuredClone(input);
    const pending = this.queue.then(async () => {
      const id = String(submitted.id || '');
      if (!this.source(id)) throw new Error('ACCOUNT_SOURCE_INVALID');
      const method = String(submitted.method || 'password');
      if (!SHOPPING_LOGIN_METHODS.includes(method)
        || (['naver','kakao'].includes(id) && method !== 'password')) throw new Error('ACCOUNT_METHOD_INVALID');
      const loginId = String(submitted.loginId || '').trim();
      const password = typeof submitted.password === 'string' ? submitted.password : '';
      if (loginId.length > 320 || password.length > 1024) throw new Error('ACCOUNT_INPUT_INVALID');
      const previous = this.publicAccount(id), old = this.record(id);
      if (password && !loginId) throw new Error('ACCOUNT_ID_REQUIRED');
      if (method === 'password' && !loginId) throw new Error('ACCOUNT_ID_REQUIRED');
      const accountChanged = loginId !== previous.loginId;
      if (accountChanged && old.passwordEncrypted && !password) throw new Error('ACCOUNT_PASSWORD_REQUIRED_ON_CHANGE');
      if (method === 'password' && !password && previous.credentialCode) throw new Error('ACCOUNT_PASSWORD_REQUIRED');
      const record = {method};
      const next = {};
      if (LEGACY.has(id)) {
        next[`${id}LoginId`] = loginId;
        if (password) next[`${id}PasswordEncrypted`] = this.encrypt(password);
      } else {
        if (loginId) record.idEncrypted = this.encrypt(loginId);
        if (password) record.passwordEncrypted = this.encrypt(password);
        else if (old.passwordEncrypted) record.passwordEncrypted = old.passwordEncrypted;
      }
      next.shoppingAccounts = {...this.store.snapshot().settings.shoppingAccounts, [id]:record};
      await this.store.setSettingsCommitted(next);
      await this.onChanged(id, {accountChanged, methodChanged:previous.method !== method, passwordChanged:Boolean(password)});
      return this.publicAccount(id);
    });
    this.queue = pending.catch(() => {});
    return pending;
  }
}

// Runs inside the retailer/provider page. Returns coordinates, never field
// values. A social button is clicked on the merchant's own page so its OAuth
// state, redirect URI, popup and callback remain owned by that merchant.
export function captureShoppingLoginPage(method = 'password') {
  const visible = element => {
    if (!element || element.disabled || element.closest('[hidden],[aria-hidden="true"]')) return false;
    for (let node=element; node && node.nodeType===1; node=node.parentElement) {
      const style=getComputedStyle(node);
      if (style.display==='none' || style.visibility==='hidden') return false;
    }
    const r=element.getBoundingClientRect(); return r.width>0 && r.height>0;
  };
  const label = element => [element.innerText || element.textContent || element.value,element.getAttribute('aria-label'),element.title,
    ...[...element.querySelectorAll('img')].map(img=>img.alt)].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  const controls=[...document.querySelectorAll('a,button,input[type="submit"],[role="button"]')].filter(visible);
  const point=element=>{ if (!element) return null; const r=element.getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; };
  const text=String(document.body?.innerText || '').slice(0,40000);
  const blocked=/보안\s*(?:확인|문자)|자동입력\s*방지|2단계\s*인증|인증번호를?\s*입력|비정상적인\s*접근|access\s*denied/i.test(text);
  const authenticated=controls.some(el=>/로그아웃|log\s*out|sign\s*out/i.test(label(el)));
  const loginEntry=controls.find(el=>/로그인|log\s*in|sign\s*in/i.test(label(el))
    && !/네이버|naver|카카오|kakao|회원가입|sign\s*up/i.test(label(el)));
  const providerPattern=method==='naver' ? /네이버|naver/i : /카카오|kakao/i;
  const provider=method==='password' ? null : controls.find(el=>providerPattern.test(label(el))
    && !/공유|share|채널\s*추가|상담|문의|회원가입|sign\s*up/i.test(label(el))
    && (/로그인|login|간편|시작|계속/i.test(label(el))
      || /login|signin|auth|oauth|sns/i.test([el.id,el.className,el.getAttribute('href'),el.getAttribute('onclick'),location.pathname].join(' '))));
  const inputs=[...document.querySelectorAll('input')].filter(visible);
  const password=inputs.find(el=>el.type==='password' && el.autocomplete!=='new-password');
  const form=password?.closest('form');
  const candidates=form ? inputs.filter(el=>form.contains(el)) : inputs;
  const id=candidates.find(el=>!['password','hidden','checkbox','radio','submit','button'].includes(el.type)
    && /email|user|login|아이디|이메일|전화번호|(?:^|\s)id(?:\s|$)/i.test([el.type,el.id,el.name,el.placeholder,el.autocomplete,el.getAttribute('aria-label')].join(' ')));
  const submit=controls.find(el=>(!form || form.contains(el)) && /로그인|log\s*in|sign\s*in/i.test(label(el))
    && !/네이버|naver|카카오|kakao|가입|sign\s*up/i.test(label(el)))
    || (form && [...form.querySelectorAll('button[type="submit"],input[type="submit"]')].find(visible));
  const next=!password && id && controls.find(el=>/^(?:다음|계속|continue|next)$/i.test(label(el)));
  return {href:location.href,blocked,authenticated,provider:point(provider),loginEntry:point(loginEntry),
    id:point(id),password:point(password),submit:point(submit),next:point(next)};
}

export class ShoppingLoginConnector {
  constructor({accounts, BrowserWindow, partition, windows, notify, wait = ms=>new Promise(resolve=>setTimeout(resolve,ms)),
    setIntervalImpl=setInterval, clearIntervalImpl=clearInterval}) {
    Object.assign(this,{accounts,BrowserWindow,partition,windows,notify,wait,setIntervalImpl,clearIntervalImpl});
    this.states=new Map();
  }
  status(id) { return this.states.get(id) || {code:'',message:''}; }
  update(id,code,message) {
    if(this.states.get(id)?.code===code && this.states.get(id)?.message===message) return;
    this.states.set(id,{code,message}); this.notify?.({sourceId:id,code,message});
  }
  async open(id) {
    const source=this.accounts.source(id);
    if (!source) return {ok:false,code:'ACCOUNT_SOURCE_INVALID'};
    const existing=this.windows.get(id);
    if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return {ok:true,opened:true}; }
    const record=this.accounts.publicAccount(id), method=record.method;
    const win=new this.BrowserWindow({title:`${source.name} 로그인 · Around G`,width:1120,height:820,show:true,autoHideMenuBar:true,
      webPreferences:{partition:this.partition,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    this.windows.set(id,win);
    const flow={source,method,started:Date.now(),acted:new Set(),children:new Set(),stopped:false};
    this.update(id,'LOGIN_OPENED',`${source.name} 로그인 화면을 확인하고 있습니다.`);
    this.attach(win,flow);
    win.on('closed',()=>{
      flow.stopped=true;
      for(const child of flow.children) if(!child.isDestroyed()) child.close();
      if(this.windows.get(id)===win) this.windows.delete(id);
      this.notify?.({sourceId:id});
    });
    void win.loadURL(source.loginUrl || source.url).catch(()=>this.update(id,'LOGIN_PAGE_LOAD_FAILED','로그인 페이지를 열지 못했습니다. 다시 연결해 주세요.'));
    return {ok:true,opened:true,automatic:{ok:false,pending:true}};
  }
  attach(win,flow) {
    let busy=false;
    const cookies=win.webContents.session.cookies;
    const tick=async()=>{
      if(flow.stopped || win.isDestroyed()) {this.clearIntervalImpl(timer);return;}
      if(busy) return;
      busy=true;
      try { await this.advance(win,flow); }
      catch { this.update(flow.source.id,'LOGIN_ACTION_FAILED','자동 입력을 완료하지 못했습니다. 열린 창에서 이어서 로그인해 주세요.'); }
      finally { busy=false;if(flow.automaticStopped)this.clearIntervalImpl(timer); }
    };
    win.webContents.setWindowOpenHandler(({url})=> {
      // Preserve window.opener for retailer-owned OAuth popups. Blank popups
      // may receive the authorize URL immediately after window.open returns.
      if(url!=='about:blank' && !/^https:\/\//i.test(url)) return {action:'deny'};
      return {action:'allow',overrideBrowserWindowOptions:{show:true,width:1000,height:800,
        webPreferences:{partition:this.partition,sandbox:true,contextIsolation:true,nodeIntegration:false}}};
    });
    win.webContents.on('did-create-window',child=>{flow.children.add(child);this.attach(child,flow);child.on('closed',()=>flow.children.delete(child));});
    win.webContents.on('dom-ready',tick);
    win.webContents.on('did-navigate-in-page',tick);
    const timer=this.setIntervalImpl(tick,750);
    win.on('closed',()=>{this.clearIntervalImpl(timer);void cookies.flushStore().catch(()=>{});});
    void tick();
  }
  async advance(win,flow) {
    const url=win.webContents.getURL();
    const merchant=shoppingLoginHostAllowed(url,flow.source.domains);
    const provider=flow.method==='naver' && shoppingLoginHostAllowed(url,['nid.naver.com']) ? 'naver'
      : flow.method==='kakao' && shoppingLoginHostAllowed(url,['accounts.kakao.com']) ? 'kakao' : '';
    if(!merchant && !provider) {
      if(Date.now()-flow.started>120000) flow.automaticStopped=true;
      if(Date.now()-flow.started>15000) this.update(flow.source.id,'LOGIN_MANUAL_REQUIRED','외부 인증 화면입니다. 열린 창에서 직접 로그인을 진행해 주세요.');
      return;
    }
    const method=merchant && !['naver','kakao'].includes(flow.source.id) ? flow.method : 'password';
    const state=await win.webContents.mainFrame.executeJavaScript(`(${captureShoppingLoginPage.toString()})(${JSON.stringify(method)})`,true);
    if(!state || state.href!==url || win.webContents.getURL()!==url) return;
    const setStatus=(code,message)=>this.update(flow.source.id,code,message);
    if(merchant && state.authenticated && !state.blocked) {
      await win.webContents.session.cookies.flushStore();
      flow.stopped=true;
      setStatus('LOGIN_CONFIRMED','쇼핑몰 로그인 확인 완료'); return;
    }
    if(Date.now()-flow.started>120000) {
      flow.automaticStopped=true;
      setStatus('LOGIN_MANUAL_REQUIRED','자동 연결 시간이 끝났습니다. 열린 창에서 로그인을 이어서 완료해 주세요.');
      return;
    }
    if(state.blocked) { setStatus('LOGIN_VERIFICATION_REQUIRED','보안 확인이 필요합니다. 열린 로그인 창에서 완료해 주세요.'); return; }
    const click=async point=>{
      if(win.isDestroyed() || win.webContents.getURL()!==url) throw new Error('LOGIN_PAGE_CHANGED');
      win.focus();
      win.webContents.focus();
      win.webContents.sendInputEvent({type:'mouseMove',...point});
      win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
      win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
      await this.wait(120);
    };
    const once=key=>{if(flow.acted.has(key))return false;flow.acted.add(key);return true;};
    if(merchant && method!=='password') {
      if(state.provider && once('provider')) {
        await click(state.provider);setStatus('SOCIAL_LOGIN_OPENED',`${method==='naver'?'네이버':'카카오'} 로그인 창에서 연결을 진행해 주세요.`);
      } else if(!state.provider && state.loginEntry && once('entry')) await click(state.loginEntry);
      else if(!state.provider && Date.now()-flow.started>15000 && !flow.acted.has('provider'))
        setStatus('SOCIAL_LOGIN_NOT_FOUND','선택한 간편 로그인 버튼을 찾지 못했습니다. 쇼핑몰 창에서 지원 여부를 확인해 주세요.');
      return;
    }
    const credentialId=provider || flow.source.id;
    const credentials=this.accounts.credentials(credentialId);
    if(credentials.code) {
      setStatus(credentials.code,credentials.code==='ACCOUNT_CREDENTIALS_UNREADABLE'
        ? '저장 계정을 읽을 수 없습니다. 비밀번호를 다시 저장해 주세요.'
        : `${credentialId==='naver'?'네이버':credentialId==='kakao'?'카카오':flow.source.name} 계정을 저장하거나 열린 창에서 직접 로그인해 주세요.`);
      return;
    }
    const fill=async(point,value)=>{
      await click(point);
      if(win.isDestroyed() || win.webContents.getURL()!==url) throw new Error('LOGIN_PAGE_CHANGED');
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
      await win.webContents.insertText(value);
    };
    const origin=new URL(url).origin;
    if(state.password && state.submit && (state.id || flow.acted.has(origin+':id')) && once(origin+':submit')) {
      if(state.id) await fill(state.id,credentials.loginId);
      await fill(state.password,credentials.password);
      await click(state.submit);
      setStatus('LOGIN_SUBMITTED','로그인 정보를 입력했습니다. 인증 또는 로그인 결과를 확인해 주세요.');
    } else if(state.id && state.next && once(origin+':id')) {
      await fill(state.id,credentials.loginId);await click(state.next);
    } else if(!state.password && state.loginEntry && once('entry')) await click(state.loginEntry);
  }
}
