# Sandsphere 작업 지침

- 이 저장소의 개발 버전은 `package.json`이 정본이다. `package-lock.json`과 앱 상단 버전은 항상 같은 버전에서 파생되게 유지한다. 앱 표시를 별도 숫자로 직접 수정하지 않는다.
- 사용자에게 보이는 기능·동작·저장 형식 변경은 같은 작업에서 `CHANGELOG.md`의 `Unreleased` 항목에 기록한다. 아직 검증하지 않은 기능을 완료된 릴리즈로 기록하지 않는다.
- 버전은 SemVer를 사용한다. 알파 개발은 `X.Y.Z-alpha.N`, 베타는 `X.Y.Z-beta.N`, 정식 릴리즈는 `X.Y.Z`다. 수정의 영향에 맞춰 다음 버전을 정하고 `npm version <version> --no-git-tag-version --ignore-scripts`로 패키지와 잠금 파일을 함께 변경한다.
- 릴리즈 전에는 `CHANGELOG.md`의 해당 버전 항목을 확정하고 `npm run check:version`, `npm test`, `npm run build`를 확인한다. 저장 형식이나 계정 규칙이 바뀌면 관련 검증도 수행한다.
- Gitea 릴리즈 설명은 확정된 변경 기록을 바탕으로 작성한다. 태그는 `vX.Y.Z` 형식이며 태그·패키지 버전이 같아야 한다. 사용자가 실제 배포를 요청하지 않은 작업에서는 릴리즈를 발행하거나 운영 사이트에 배포하지 않는다.
- 운영 배포 절차와 롤백은 `docs/OPERATIONS.md`를 따른다. 과거 릴리즈 항목은 실제 태그와 코드에 근거해 유지한다.
