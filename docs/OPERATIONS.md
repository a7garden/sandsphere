# Sandsphere 운영과 사용자 저장

정본 개발 경로는 `/Users/garden/Workspace/Projects/sandsphere`다. Git 원격과 릴리즈는 Mac mini의 Gitea `http://100.81.146.46:3000/garden/sandsphere`를 사용한다. Cloudflare Workers Static Assets가 `sandsphere.app`을 제공한다. Firebase Hosting은 사용하지 않는다.

공개 소스는 GitHub의 `a7garden/sandsphere`에 게시한다. 로컬 `origin`은 기존 Gitea, `github`는 공개 GitHub 원격이며 GitHub의 기본 브랜치는 `main`이다. GitHub Actions는 운영 인증정보 없이 버전·테스트·보안 규칙·빌드를 검증한다. 운영 릴리즈와 배포는 계속 Gitea에서 수행한다. 공개 PR 코드를 운영 인증정보가 있는 전용 호스트에서 실행하지 않는다.

## 계정 저장

Firebase Authentication의 이메일/비밀번호와 Google 로그인을 지원한다. 계정별 IndexedDB 슬롯과 재시작 체크포인트·발견 기록·알림 기록을 분리한다. 외관과 빠른 선택 같은 기기 설정은 브라우저에 남는다. 로그인·로그아웃 전에 현재 물리 단계와 로컬 저장을 정산하고 다시 열어 이전 계정의 실행 상태가 섞이지 않게 한다.

로컬 저장은 5초마다, 클라우드는 최대 1분에 한 번 저장한다. ‘계정과 저장 → 지금 저장’은 즉시 업로드한다. 종료 직전에는 로컬 체크포인트를 남기며 브라우저 종료 뒤 네트워크 저장 완료를 가정하지 않는다. 온라인 복원은 Firebase 인증이 준비된 다음 수행한다. 연결 실패 시 계정의 로컬 저장본으로 진행하고 ‘지금 저장’에서 재시도한다.

행성 최대 네 개, 공유 재고, 탐사 과제, 발견, 기후, 물리 상태와 대시보드 기록을 한 묶음으로 저장한다. 전체 저장본을 gzip으로 압축하고 Firestore `users/{uid}/revisions/{revision}/parts/{index}`에 최대 512 KiB씩 분할해 저장한다. 문서당 1 MiB 제한보다 작게 유지하며 바이너리 필드는 인덱스에서 제외한다. 모든 조각을 업로드한 다음 `users/{uid}/saves/current` 포인터를 트랜잭션에서 바꾼다. 기존 revision이 예상과 같은 경우에만 커밋한다. 다른 기기의 저장을 발견하면 자동 덮어쓰기를 중지한다.

사용자가 클라우드/이 기기 중 하나를 선택하기 전 로컬 원본을 별도 슬롯에 보관한다. 기기 간 벽시계 시간을 비교해 승자를 정하지 않는다. 로그인 실패나 네트워크 장애 때 비회원 데이터를 임의로 계정에 복사하지 않는다. 빈 계정에서 ‘비회원 게임 가져오기’를 명시적으로 실행할 수 있다. 기존 비회원 저장 슬롯은 삭제하지 않는다.

보안 규칙은 본인 UID의 저장본만 읽고 쓸 수 있게 제한하고 목록 조회·다른 UID 접근·기존 조각 덮어쓰기를 차단한다. 현재 revision과 바로 이전 revision의 삭제도 차단한다. 커밋 후 더 오래된 revision과 실패한 업로드 조각을 정리한다. 정리 실패는 저장 성공을 취소하지 않으므로 드문 장애 때 남은 조각은 운영자가 점검한다. 원본 JSON은 64 MiB, 압축본은 20 MiB까지 허용한다. 저장본은 Firebase 인증을 통해 읽으며 공개 URL은 없다. 무료 할당량을 넘으면 클라우드 저장은 실패하고 로컬 저장은 남는다. 운영 규모가 늘면 사용량과 요금제를 다시 검토한다. 기존 format 1 Cloud Storage 저장본은 버킷 설정이 있을 때 읽을 수 있다.

## Firebase 운영 연결

프로젝트 `sandsphere-app`, Web App `1:643782072311:web:938f97b65156ece22240f2`, Firestore `(default)`는 서울 `asia-northeast3`에 있다. 이메일/비밀번호와 Google 로그인이 활성화되어 있고 `sandsphere.app`이 인증 허용 도메인에 등록되어 있다. Firebase Hosting의 기본 인증 handler만 사용하며 게임 사이트는 Cloudflare가 제공한다.

공개 Web App 설정 네 개를 `.env.production.local` 또는 Gitea secrets에 등록한다. API key는 앱 식별값이며 데이터 접근은 보안 규칙이 제한한다. Cloud Storage 버킷은 format 1 레거시 저장본을 읽을 때만 선택적으로 설정한다. 운영 format 2에는 Storage·Blaze 결제 연결이 필요하지 않다.

```sh
npx firebase deploy --project sandsphere-app --only auth
npx firebase deploy --project sandsphere-app --only firestore:rules,firestore:indexes
```

개인 비공개 저장소의 전용 Mac mini runner는 소유자의 Firebase CLI 로그인과 Wrangler OAuth를 사용한다. 인증 파일은 호스트의 소유자만 읽을 수 있게 0600으로 보호한다. 일반/공유 runner에서는 Firebase 배포 권한으로 한정한 `FIREBASE_SERVICE_ACCOUNT`와 Cloudflare API token을 Gitea secrets에 등록한다. 서비스 계정 키를 `VITE_` 변수에 넣지 않는다.

## Cloudflare와 Gitea 릴리즈

### 버전과 릴리즈 노트

`package.json`의 버전이 앱 상단 표시의 정본이며 `package-lock.json`은 같은 값으로 유지한다. 개발 중에는 `0.5.0-alpha.1`처럼 선행 버전을 사용한다. 사용자에게 보이는 변경은 작업할 때마다 루트 `CHANGELOG.md`의 `Unreleased`에 적는다. 버전을 올릴 때는 `npm version <version> --no-git-tag-version --ignore-scripts`를 사용하고 `npm run check:version`으로 패키지·잠금 파일·변경 기록을 확인한다.

정식 릴리즈 전에 `Unreleased`의 내용을 해당 버전과 날짜 아래로 옮기고, Gitea 릴리즈 설명을 그 항목에서 작성한다. 릴리즈 태그는 패키지 버전과 같은 `vX.Y.Z` 형식이어야 한다. 알파·베타 태그는 운영 배포를 시작하지 않는다. 다음 릴리즈 준비 중에도 직전의 안정 배포와 개발 버전을 혼동하지 않도록 앱 상단에 개발 버전을 표시한다.

`wrangler.jsonc`는 `sandsphere.app` Custom Domain을 사용한다. 해당 도메인이 배포 계정의 활성 Cloudflare zone에 있어야 한다. 운영용 API token은 해당 계정의 Workers Scripts 편집, 해당 zone의 Workers Routes 편집 및 Zone 조회 권한을 사용한다.

Gitea 저장소 secrets:

- `CLOUDFLARE_ACCOUNT_ID`, 선택 사항 `CLOUDFLARE_API_TOKEN` (없으면 전용 호스트의 Wrangler 로그인)
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
- 선택 사항 `FIREBASE_SERVICE_ACCOUNT` (없으면 전용 호스트의 Firebase CLI 로그인)

Actions의 내장 `GITEA_TOKEN`은 릴리즈 첨부에 사용한다. Mac mini에 이 저장소만 대상으로 하는 `sandsphere-mini` runner(3.0.2, label `sandsphere-macos:host`)를 등록했다. launchd `com.a7.sandsphere.runner`, 바이너리·등록 정보는 `~/Tools/sandsphere-runner`, 코드 작업 경로는 `~/Workspace/Projects/sandsphere-ci`다. Node 24.21.0 기본 런타임을 공식 SHA256으로 확인했다. Node·Java 작업용 버전은 setup actions에서 준비한다. 검증 워크플로에는 운영 secrets를 제공하지 않는다. runner는 본인의 비공개 저장소 코드만 실행하며 호스트 실행 모드이므로 다른 저장소나 신뢰하지 않는 PR을 등록하지 않는다. mini의 로컬 `http://127.0.0.1:9101/healthz`로 상태를 확인할 수 있다.

배포는 `v0.4.2` 같은 **정식 Gitea 릴리즈 발행**으로 시작한다. draft/prerelease와 일반 push는 운영 배포를 시작하지 않는다. 테스트 → 보안 규칙 에뮬레이터 검증 → Firebase 운영 설정 검증 → 태그에 해당하는 빌드 → 압축 빌드와 SHA256 릴리즈 첨부 → Firebase 규칙·인덱스 배포 → Cloudflare 배포 → 도메인의 `release.json` 태그·커밋 검증 순서다. Firebase 설정이 없거나 demo/emulator 설정이면 운영 빌드를 차단한다.

보안 규칙 배포와 정적 사이트 배포는 서로 다른 서비스의 작업으로 원자적이지 않다. 이번 규칙은 현재 저장 구조만 추가하므로 기존 규칙 변경 시 먼저 이전 앱과의 호환성을 검토한다. 배포 실패는 Gitea Actions 결과에서 확인한다. Cloudflare로의 직접 개발 배포를 운영 릴리즈 흐름 대신 사용하지 않는다.

되돌리기는 Cloudflare 이전 배포 버전 또는 Gitea에 첨부된 검증된 압축 빌드를 사용한다. 저장 포맷을 읽을 수 있는 버전으로만 되돌리고 사용자 게임 저장본을 삭제하지 않는다.

## 검증과 개발

```sh
npm ci
npm test
npm run build
# Java 21 이상이 PATH에 필요하다.
npm run test:rules
# 별도 터미널 두 개에서:
npm run emulators
npm run dev:emulator
```

`.env.emulator`는 실제 Firebase 프로젝트를 사용하지 않는 `demo-sandsphere` 설정이다. `?test=1` 검수 모드에서는 클라우드 인증·저장을 연결하지 않는다. 에뮬레이터 사용 플래그는 개발 빌드에서만 작동한다.

공식 근거: [Firebase 트랜잭션](https://firebase.google.com/docs/firestore/manage-data/transactions), [Firestore 사용량과 문서 제한](https://firebase.google.com/docs/firestore/quotas), [Firestore 보안 규칙](https://firebase.google.com/docs/firestore/security/rules-conditions), [Cloudflare 정적 자산](https://developers.cloudflare.com/workers/static-assets/), [Gitea Actions](https://docs.gitea.com/usage/actions/).
