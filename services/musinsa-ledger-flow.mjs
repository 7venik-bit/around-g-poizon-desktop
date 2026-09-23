import {randomUUID} from 'node:crypto';

export const musinsaLedgerFailure = code => ({ok:false,code,message:({
  NOT_MUSINSA:'무신사 주문 화면에서 다시 시도해 주세요.',
  MUSINSA_LOGIN_REQUIRED:'무신사 로그인을 완료한 뒤 다시 주문 내역을 열어주세요.',
  MUSINSA_ACCESS_RESTRICTED:'무신사에서 접근 제한 또는 보안 확인을 표시했습니다. 열린 창에서 확인해 주세요.',
  ORDER_DETAIL_REQUIRED:'무신사 주문 내역에서 기록할 주문의 주문상세를 클릭한 뒤 주문상세 인식을 눌러주세요.',
  ORDER_IDENTITY_INCOMPLETE:'주문상세의 주문번호·구매일을 확인하지 못했습니다. 화면이 모두 표시된 뒤 다시 인식해 주세요.',
  ORDER_PRODUCTS_NOT_FOUND:'주문상세에서 구매 상품을 확인하지 못했습니다. 상품 영역을 펼친 뒤 다시 인식해 주세요.',
  ORDER_PAGE_CHANGED:'인식 중 주문 화면이 바뀌었습니다. 기록할 주문상세를 다시 인식해 주세요.',
  ORDER_CAPTURE_REQUIRED:'주문상세 인식을 먼저 완료한 뒤 장부에 기록해 주세요.',
  ORDER_CAPTURE_MISMATCH:'인식한 주문과 입력한 주문번호·구매일·링크가 다릅니다. 해당 주문상세를 다시 인식해 주세요.',
})[code] || '무신사 주문 화면을 확인한 뒤 다시 시도해 주세요.'});

// Only the observed My-page order-history control is clicked. The user chooses
// the order; there is no guessed route and no automatic choice of a purchase.
export async function advanceMusinsaLedgerToOrders({inspect,click,wait,attempts=20}) {
  let clicked=false;
  for(let index=0;index<attempts;index++) {
    const page=await inspect();
    if(page?.kind==='blocked')return musinsaLedgerFailure('MUSINSA_ACCESS_RESTRICTED');
    if(page?.kind==='login')return musinsaLedgerFailure('MUSINSA_LOGIN_REQUIRED');
    if(page?.kind==='outside')return musinsaLedgerFailure('NOT_MUSINSA');
    if(['orders','detail'].includes(page?.kind))return {ok:true,stage:page.kind};
    if(page?.orderAction && !clicked) {await click(page);clicked=true;}
    await wait(350);
  }
  return {ok:true,stage:'my',message:'마이 화면에서 주문 내역을 누르고, 기록할 주문상세를 선택해 주세요.'};
}

// The renderer cannot turn a manually entered row or a product listing into an
// order capture. Keep the proof in the main process and bind it to the order.
export class MusinsaLedgerCaptures {
  constructor(){this.rows=new Map();}
  register(rows){
    this.rows.clear();
    return rows.map(row=>{const captureId=randomUUID();this.rows.set(captureId,structuredClone(row));return {...row,captureId};});
  }
  resolve(input,failedRow){
    const retry=failedRow?.id===input.retryId && failedRow?.syncStatus==='failed' && failedRow?.orderEvidence?.version===1 ? failedRow : null;
    const captured=this.rows.get(input.captureId) || (retry && {...retry,...retry.orderEvidence});
    if(!captured)return musinsaLedgerFailure('ORDER_CAPTURE_REQUIRED');
    const identity=value=>String(value||'').trim().replace(/[?#].*$/,'');
    if(['orderNumber','purchaseDate','purchaseUrl'].some(key=>identity(input[key])!==identity(captured[key])))return musinsaLedgerFailure('ORDER_CAPTURE_MISMATCH');
    return {ok:true,cardIssuer:captured.cardIssuer || '',evidence:{version:1,orderNumber:captured.orderNumber,purchaseDate:captured.purchaseDate,
      sourceOrderUrl:captured.sourceOrderUrl,orderLineId:captured.orderLineId,productId:captured.productId}};
  }
}
