# 계정 저장 검증 — 2026-10-10

- 단위 테스트: 비회원·검수·계정 슬롯 분리, 변경된 revision의 충돌 판정, 기기 간 시계 차이, 압축 저장본 복원과 손상/부분 저장본 거부.
- 실제 Firebase Firestore/Storage 에뮬레이터: 다른 사용자 및 비로그인 사용자의 읽기/쓰기 거부, 저장 목록 조회 거부, 잘못된 manifest와 MIME 거부, 기존 압축 파일 변경 거부.
- 두 동시 작성자가 같은 이전 revision으로 저장하면 한 명만 커밋되고 다른 작성자는 충돌을 받는다. 커밋된 세계를 다시 읽어 확인하고 계정이 바뀌면 이전 UID의 작업을 거부한다.
- 실제 앱 브라우저 검증: 에뮬레이터 Alice 로그인 → `Alice의 행성` 생성 → 클라우드 저장 성공 → 로그아웃 시 빈 비회원 화면 → Bob 로그인 시 빈 계정 → Alice 재로그인 시 자신의 행성 복원.
- Cloudflare `wrangler deploy --dry-run`이 정적 자산과 Custom Domain 설정을 정상적으로 처리했다.

실제 운영 Google OAuth, Firebase 프로젝트·버킷 CORS, Gitea runner의 운영 secret 연결, Cloudflare 도메인 HTTPS 배포는 운영 계정 연결 뒤 검증해야 한다. 로컬/에뮬레이터 성공을 운영 배포 성공으로 간주하지 않는다.

검증 화면: `artifacts/account-cloud-save.jpg`.
