# Sandsphere 운영과 사용자 저장

정본 개발 경로는 `/Users/garden/Workspace/Projects/sandsphere`다. Git 원격과 릴리즈는 Mac mini의 Gitea `http://100.81.146.46:3000/garden/sandsphere`를 사용한다. Cloudflare Workers Static Assets가 `sandsphere.app`을 제공한다. Firebase Hosting은 사용하지 않는다.

## 계정 저장

Firebase Authentication의 이메일/비밀번호와 Google 로그인을 지원한다. 계정별 IndexedDB 슬롯과 재시작 체크포인트·발견 기록·알림 기록을 분리한다. 외관과 빠른 선택 같은 기기 설정은 브라우저에 남는다. 로그인·로그아웃 전에 현재 물리 단계와 로컬 저장을 정산하고 다시 열어 이전 계정의 실행 상태가 섞이지 않게 한다.

로컬 저장은 5초마다, 클라우드는 최대 1분에 한 번 저장한다. ‘계정과 저장 → 지금 저장’은 즉시 업로드한다. 종료 직전에는 로컬 체크포인트를 남기며 브라우저 종료 뒤 네트워크 저장 완료를 가정하지 않는다. 온라인 복원은 Firebase 인증이 준비된 다음 수행한다. 연결 실패 시 계정의 로컬 저장본으로 진행하고 ‘지금 저장’에서 재시도한다.

행성 최대 네 개, 공유 재고, 탐사 과제, 발견, 기후, 물리 상태와 대시보드 기록을 한 묶음으로 저장한다. 데이터가 Firestore 문서 제한을 넘을 수 있어 전체 저장본은 gzip으로 압축해 Cloud Storage `users/{uid}/saves/{revision}.json.gz`에 쓴다. Firestore `users/{uid}/saves/current`에는 현재 revision만 기록한다. 새 파일 업로드 후 트랜잭션에서 기존 revision이 예상과 같은 경우에만 현재 포인터를 바꾼다. 다른 기기의 저장을 발견하면 자동 덮어쓰기를 중지한다.

사용자가 클라우드/이 기기 중 하나를 선택하기 전 로컬 원본을 별도 슬롯에 보관한다. 기기 간 벽시계 시간을 비교해 승자를 정하지 않는다. 로그인 실패나 네트워크 장애 때 비회원 데이터를 임의로 계정에 복사하지 않는다. 빈 계정에서 ‘비회원 게임 가져오기’를 명시적으로 실행할 수 있다. 기존 비회원 저장 슬롯은 삭제하지 않는다.

보안 규칙은 본인 UID의 저장본만 읽고 쓸 수 있게 제한하고 목록 조회·다른 UID 접근·기존 압축 파일 덮어쓰기·삭제를 차단한다. 원본 JSON은 64 MiB, 압축본은 20 MiB까지 허용한다. 인증된 다운로드를 사용하고 공개 다운로드 URL은 생성하지 않는다. 이전 압축 revision은 복구를 위해 보존하므로 저장 용량이 누적된다. 운영 전 사용량 알림과 보존 정책을 정해야 한다. 단순히 저장 폴더 전체에 수명 주기를 적용하면 장기간 접속하지 않은 사용자의 현재 저장본도 지워지므로 그렇게 설정하지 않는다.

## Firebase 최초 연결

1. 운영 Firebase 프로젝트와 Web App을 만들고 Authentication에서 이메일/비밀번호 및 Google을 활성화한다. authorized domains에 `sandsphere.app`을 추가한다.
2. Firestore 기본 데이터베이스와 Cloud Storage 버킷을 만든다. Cloud Storage 사용에는 프로젝트의 Blaze 요금제 연결이 필요하므로 소유자가 결제 연결을 완료해야 한다.
3. Web App 공개 설정 다섯 개를 `.env.production.local`에 넣는다(`.env.example` 참조). API key는 웹 앱 식별값이며, 접근 제한은 보안 규칙이 담당한다. 서비스 계정 키를 `VITE_` 변수에 넣지 않는다.
4. 보안 규칙을 배포하고 버킷 CORS를 적용한다. `storage.cors.json`의 개발 origin은 필요할 때만 유지한다.

```sh
npx firebase deploy --project PROJECT_ID --only firestore:rules,storage
gcloud storage buckets update gs://BUCKET --cors-file=storage.cors.json
```

Google 서비스 계정은 해당 프로젝트의 Firestore/Storage 규칙 배포 권한만 부여하고 JSON을 Gitea 저장소의 `FIREBASE_SERVICE_ACCOUNT` secret에 등록한다. Web App 설정은 아래의 `VITE_FIREBASE_*` secrets에 등록한다. Google OAuth 허용 도메인과 실제 Storage CORS는 계정 연결 후 별도로 검증해야 한다.

## Cloudflare와 Gitea 릴리즈

`wrangler.jsonc`는 `sandsphere.app` Custom Domain을 사용한다. 해당 도메인이 배포 계정의 활성 Cloudflare zone에 있어야 한다. 운영용 API token은 해당 계정의 Workers Scripts 편집, 해당 zone의 Workers Routes 편집 및 Zone 조회 권한을 사용한다.

Gitea 저장소 secrets:

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_APP_ID`
- `FIREBASE_SERVICE_ACCOUNT`

Actions의 내장 `GITEA_TOKEN`은 릴리즈 첨부에 사용한다. Mac mini에 이 저장소만 대상으로 하는 `sandsphere-mini` runner(3.0.2, label `sandsphere-macos:host`)를 등록했다. launchd `com.a7.sandsphere.runner`, 바이너리·등록 정보는 `~/Tools/sandsphere-runner`, 코드 작업 경로는 `~/Workspace/Projects/sandsphere-ci`다. Node 24.21.0 기본 런타임을 공식 SHA256으로 확인했다. Node·Java 작업용 버전은 setup actions에서 준비한다. 검증 워크플로에는 운영 secrets를 제공하지 않는다. runner는 본인의 비공개 저장소 코드만 실행하며 호스트 실행 모드이므로 다른 저장소나 신뢰하지 않는 PR을 등록하지 않는다. mini의 로컬 `http://127.0.0.1:9101/healthz`로 상태를 확인할 수 있다.

배포는 `v0.4.0` 같은 **정식 Gitea 릴리즈 발행**으로 시작한다. draft/prerelease와 일반 push는 운영 배포를 시작하지 않는다. 테스트 → 보안 규칙 에뮬레이터 검증 → Firebase 운영 설정 검증 → 태그에 해당하는 빌드 → 압축 빌드와 SHA256 릴리즈 첨부 → Firebase 규칙 배포 → Cloudflare 배포 → 도메인의 `release.json` 태그·커밋 검증 순서다. Firebase 설정이 없거나 demo/emulator 설정이면 운영 빌드를 차단한다.

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

공식 근거: [Firebase 트랜잭션](https://firebase.google.com/docs/firestore/manage-data/transactions), [Storage 개인별 접근 규칙](https://firebase.google.com/docs/storage/security/rules-conditions), [인증 다운로드와 CORS](https://firebase.google.com/docs/storage/web/download-files), [Cloudflare 정적 자산](https://developers.cloudflare.com/workers/static-assets/), [Gitea Actions](https://docs.gitea.com/usage/actions/).
