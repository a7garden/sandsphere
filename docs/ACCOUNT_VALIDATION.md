# 계정 저장 검증 — 2026-10-10

- 단위 테스트: 비회원·검수·계정 슬롯 분리, 변경된 revision의 충돌 판정, 기기 간 시계 차이, 압축 저장본 복원과 손상/부분 저장본 거부.
- 실제 Firebase Firestore/Storage 에뮬레이터: 다른 사용자 및 비로그인 사용자의 읽기/쓰기 거부, 저장 목록 조회 거부, 잘못된 manifest와 MIME 거부, 기존 압축 파일 변경 거부.
- 두 동시 작성자가 같은 이전 revision으로 저장하면 한 명만 커밋되고 다른 작성자는 충돌을 받는다. 커밋된 세계를 다시 읽어 확인하고 계정이 바뀌면 이전 UID의 작업을 거부한다.
- 실제 앱 브라우저 검증: 에뮬레이터 Alice 로그인 → `Alice의 행성` 생성 → 클라우드 저장 성공 → 로그아웃 시 빈 비회원 화면 → Bob 로그인 시 빈 계정 → Alice 재로그인 시 자신의 행성 복원.
- Cloudflare `wrangler deploy --dry-run`이 정적 자산과 Custom Domain 설정을 정상적으로 처리했다.

2026-10-10 운영 연결: `sandsphere-app`의 서울 Firestore와 이메일·Google 로그인 설정을 활성화했다. Cloudflare 계정과 활성 `sandsphere.app` 도메인을 확인했다. 전용 Gitea runner에 Firebase·Cloudflare 인증을 연결하고 공개 Web App 설정을 secrets로 등록했다. 실제 HTTPS 앱의 로그인·저장·복원 검증은 배포 후 확인한다.

format 2 저장 추가 검증: Firestore 분할 조각의 사용자 격리, 변경·목록 조회·크기 초과 거부, 현재/이전 revision 삭제 거부, 동시 작성 충돌, 512 KiB보다 큰 실제 압축 저장본 왕복, 세 번째 저장 후 첫 번째 revision 정리. 에뮬레이터 테스트 5개 통과.

검증 화면: `artifacts/account-cloud-save.jpg`.
