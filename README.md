# Around G POIZON Desktop

Windows 로컬 소싱·장부 앱입니다.

## 상품 탐색

- POIZON 인기상품: 판매자센터의 가로형·세로형 표를 드래그 앤 드롭하거나 붙여넣으면 품번을 추출하고 공식 API에서 SPU·SKU를 속도 제한에 맞춰 자동 조회합니다.
- 브랜드별 검색: 검증된 한국 POIZON 브랜드 ID로 공식 상품 기본정보 API를 조회합니다.
- 카테고리별 검색: 공식 API 결과를 신발, 의류, 아우터, 가방, 모자, 액세서리, 기타로 분류합니다.
- 최근 30일 30건 필터: 판매자센터 판매량과 공식 API 상품을 품번으로 결합해 적용합니다.

## 자동 업데이트

앱은 `7venik-bit/around-g-poizon-desktop`의 GitHub Releases를 확인합니다.
새 버전이 있으면 `연동 관리 → 프로그램 업데이트`에서 다운로드할 수 있으며,
앱 종료 시 설치됩니다.

## 새 버전 배포

1. `package.json`의 `version`을 올립니다.
2. 변경사항을 기본 브랜치에 커밋합니다.
3. 같은 버전의 태그를 푸시합니다.

```powershell
git tag v1.1.0
git push origin main --tags
```

GitHub Actions가 Windows 설치 파일, `latest.yml`, blockmap을 Release에 게시합니다.
