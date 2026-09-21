// Synthetic display data only: never read or write a user's workbook.
const headings=['브랜드','구매링크','품번','모델명','성별','EU\n사이즈','한국\n사이즈','사진','판매량','판매가\n(원화)','판매\n일자','상태','구매\n일자','구매가','카드','예상\n수수료','택배비','간이마진','부가세환급','일반마진'];
const product=['테스트','https://shop.example.test/products/a-very-long-product-name-with-colour-and-size?option=123456789','ABC123-900','테스트 운동화 롱 모델명 화이트 블랙 에디션','공용','39','245','','300','₩259,000','5/22','구매완료','5/19','₩239,000','카드','₩25,900','₩3,490','-₩15,690','₩21,727','₩6,037'];
function ledgerLayoutBook(columnCount=20) {
  const wide=columnCount>=30;
  const sheetHeadings=wide?[...headings,'구매가비\n마진율','판매가비\n마진율']:headings;
  const data=wide?[...product,'-108.22%','-876.02%']:product;
  const displayValues=[Array.from({length:sheetHeadings.length},(_,c)=>c===18?'₩294,623':c===19?'#VALUE!':''),sheetHeadings,
    ...Array.from({length:100},(_,r)=>data.map((value,c)=>c===0&&wide?'테스트브랜드':c===2?(wide?`ABCD${String(r).padStart(3,'0')}-N50CRS`:`ABC${String(r).padStart(3,'0')}-900`):value))];
  return {title:'화면 확인용 예시 장부',revision:'fixture-revision',capturedAt:'2026-09-22',timeZone:'Asia/Seoul',sheets:[{
    id:1,name:'1-구매완료',columnCount,rowCount:102,displayValues,
    rawValues:displayValues.map(row=>row.map(value=>({type:'text',value}))),
    formulas:displayValues.map((row,r)=>row.map((_,c)=>r===0&&c===19?'=1+" "':'')),
    notes:displayValues.map(row=>row.map((_,c)=>c===2?'원본 품번 메모':'')),
    backgrounds:displayValues.map((row,r)=>row.map((_,c)=>c===9?'#ffe699':c===10?'#b7e1cd':c===12||c===13?'#d9ead3':r===1?'#eeeeee':'')),
    fontColors:displayValues.map(row=>row.map((_,c)=>c>=15?'#0000ff':'')),
    fontWeights:displayValues.map((row,r)=>row.map(()=>r===1||wide?'bold':'normal')),
  },{id:2,name:'숨김 예시',hidden:true,displayValues:[['00123','<script>unsafe</script>']],formulas:[['','']]}]};
}
module.exports={ledgerLayoutBook};
