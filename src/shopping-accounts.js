(() => {
  const api=window.aroundG;
  const names={password:'쇼핑몰 아이디·비밀번호',naver:'네이버로 로그인',kakao:'카카오로 로그인'};
  const escape=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const messages={ACCOUNT_ID_REQUIRED:'아이디를 입력해 주세요.',ACCOUNT_PASSWORD_REQUIRED:'비밀번호를 입력해 주세요.',
    ACCOUNT_PASSWORD_REQUIRED_ON_CHANGE:'아이디를 변경하려면 비밀번호도 입력해 주세요.',
    ACCOUNT_CREDENTIALS_UNREADABLE:'저장된 비밀번호를 읽을 수 없습니다. 다시 저장해 주세요.',
    ACCOUNT_METHOD_INVALID:'지원하는 로그인 방식을 선택해 주세요.'};
  let request=0;
  const list=()=>document.getElementById('domestic-login-list');
  function updateMethod(row) {
    const method=row.querySelector('[data-shop-method]').value;
    row.querySelector('[data-shop-fields]').hidden=method!=='password';
    row.querySelector('[data-shop-method-hint]').textContent=method==='password'
      ? '해당 쇼핑몰에서 가입한 계정을 입력하세요.'
      : `${method==='naver'?'위의 네이버 계정':'목록의 카카오 계정'}으로 연결합니다. 쇼핑몰에서 이 로그인 방식을 지원해야 합니다.`;
  }
  function card(source) {
    const row=document.createElement('details');
    row.className='shopping-account-card';row.dataset.shoppingAccount=source.id;
    if(source.id==='kakao') row.open=true;
    row.innerHTML=`<summary><strong>${escape(source.name)}</strong><span data-shop-state></span></summary>
      <div class="shopping-account-body">
        <label>로그인 방식<select data-shop-method aria-label="${escape(source.name)} 로그인 방식">${source.methods.map(method=>`<option value="${method}">${names[method]}</option>`).join('')}</select></label>
        <p class="muted" data-shop-method-hint></p>
        <div class="shopping-account-fields" data-shop-fields>
          <label>아이디<input data-shop-id autocomplete="username" aria-label="${escape(source.name)} 아이디"></label>
          <label>비밀번호<input data-shop-password type="password" autocomplete="new-password" placeholder="변경할 때만 입력" aria-label="${escape(source.name)} 비밀번호"></label>
        </div>
        <div class="shopping-account-actions"><button type="button" data-shop-save>저장</button><button type="button" class="primary" data-shop-connect>저장하고 로그인</button><button type="button" data-shop-clear>로그인 해제</button></div>
        <p data-shop-message role="status" aria-live="polite"></p>
      </div>`;
    return row;
  }
  async function render() {
    const target=list();if(!target || !api.listShoppingAccounts) return;
    const revision=++request;
    let sources;
    try { sources=await api.listShoppingAccounts(); }
    catch { if(!target.querySelector('[data-shopping-account]')) target.textContent='저장된 계정을 불러오지 못했습니다. 상태 새로고침을 눌러 주세요.';return; }
    if(revision!==request) return;
    if(!target.querySelector('[data-shopping-account]')) target.replaceChildren();
    for(const source of sources.filter(source=>source.id!=='naver')) {
      let row=[...target.querySelectorAll('[data-shopping-account]')].find(row=>row.dataset.shoppingAccount===source.id);
      if(!row) {row=card(source);target.append(row);}
      if(row.dataset.dirty!=='true' && row.dataset.busy!=='true') {
        row.querySelector('[data-shop-method]').value=source.method;
        row.querySelector('[data-shop-id]').value=source.loginId || '';
      }
      row.querySelector('[data-shop-state]').textContent=source.connection?.code==='LOGIN_CONFIRMED'
        ? '로그인 확인 완료' : source.hasSession ? '저장된 세션 있음'
          : source.configured ? '계정·방식 저장됨' : '계정 설정 필요';
      if(source.connection?.message && row.dataset.busy!=='true') row.querySelector('[data-shop-message]').textContent=source.connection.message;
      row.querySelector('[data-shop-clear]').hidden=!source.hasSession;
      row.querySelector('[data-shop-password]').placeholder=source.hasPassword ? '저장됨 · 변경할 때만 입력' : '비밀번호 입력';
      updateMethod(row);
    }
  }
  async function act(row, connect=false) {
    if(row.dataset.busy==='true') return;
    row.dataset.busy='true';
    const controls=[...row.querySelectorAll('button,input,select')];controls.forEach(control=>control.disabled=true);
    const status=row.querySelector('[data-shop-message]');status.textContent='계정 정보를 저장하고 있습니다.';
    let saved=false;
    try {
      const account=await api.saveShoppingAccount({id:row.dataset.shoppingAccount,
        method:row.querySelector('[data-shop-method]').value,
        loginId:row.querySelector('[data-shop-id]').value,password:row.querySelector('[data-shop-password]').value});
      saved=true;row.dataset.dirty='false';row.querySelector('[data-shop-password]').value='';
      // Preserve the existing global settings form without displaying duplicate
      // Nike/Adidas fields or submitting stale account IDs on its next save.
      for(const suffix of ['login-id','password']) {
        const legacy=document.getElementById(`${account.id}-${suffix}`);
        if(legacy) legacy.value=suffix==='password' ? '' : account.loginId;
      }
      status.textContent='계정과 로그인 방식을 저장했습니다.';
      if(connect) {
        const result=await api.openShoppingAccount(account.id);
        status.textContent=result?.ok ? '로그인 창에서 연결을 진행하고 있습니다.' : '계정은 저장됐지만 로그인 창을 열지 못했습니다.';
      }
    } catch(error) {
      status.textContent=saved ? '계정은 저장됐지만 로그인 연결을 완료하지 못했습니다.'
        : messages[String(error?.message || '').match(/ACCOUNT_[A-Z_]+/)?.[0]] || '계정을 저장하지 못했습니다. 입력값은 유지됩니다.';
    } finally { row.dataset.busy='false';controls.forEach(control=>control.disabled=false); }
    if(saved) await render();
  }
  document.addEventListener('input',event=>{const row=event.target.closest('[data-shopping-account]');if(row) row.dataset.dirty='true';});
  document.addEventListener('change',event=>{const row=event.target.closest('[data-shopping-account]');if(row) {row.dataset.dirty='true';updateMethod(row);}});
  document.addEventListener('keydown',event=>{if(event.key==='Enter' && event.target.closest('[data-shopping-account]') && event.target.tagName==='INPUT') event.preventDefault();});
  document.addEventListener('click',async event=>{
    const row=event.target.closest('[data-shopping-account]');if(!row) return;
    if(event.target.closest('[data-shop-save]')) await act(row);
    if(event.target.closest('[data-shop-connect]')) await act(row,true);
    if(event.target.closest('[data-shop-clear]') && row.dataset.busy!=='true') {
      row.dataset.busy='true';
      let message;
      try {
        const result=await api.clearDomesticLogin(row.dataset.shoppingAccount);
        message=result?.ok
          ? '로그인을 해제했습니다. 저장한 계정은 유지됩니다.' : '로그인을 해제하지 못했습니다. 다시 시도해 주세요.';
      } catch {message='로그인을 해제하지 못했습니다. 다시 시도해 주세요.';}
      finally {row.dataset.busy='false';}
      await render();
      row.querySelector('[data-shop-message]').textContent=message;
    }
  });
  window.AroundGShoppingAccounts={render};
})();
