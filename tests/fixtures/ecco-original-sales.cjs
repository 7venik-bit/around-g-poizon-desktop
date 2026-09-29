// Representative rows of the downloaded SKU export. Values are not SPU totals.
const headers = ['SPU ID', '상품 번호', '상품명', 'SKU ID', '중국 총 판매량', '현지 판매자 총 판매량', '사이즈/옵션/색상'];
const product = (spu, article, start, china, local) => local.map((n, i) =>
  [spu, article, '에코 신발', `${spu}-${i}`, china[i], n, `색상:블랙;사이즈:EU ${start + i}`]);
module.exports = [headers,
  ...product('32556274', '85030451094', 39, [36,70,70,78,57,38,8,'<5','--'], [24,49,48,54,50,21,8,'--','--']),
  ...product('35907001', '85082354477', 35, [6,8,24,47,18,31,'<5','--','--'], ['--','--',13,17,14,26,'--','--','--']),
  ...product('4171247', '54053401001', 39, ['<5',10,17,16,11,'<5',7,'--','--','--'], ['<5',5,16,15,8,'<5',5,'--','--','--']),
];
