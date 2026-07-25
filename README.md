# Around G POIZON Desktop

Windows 로컬 소싱·장부 앱입니다.

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
