# 계정 저장 검증 — 2026-10-10

- 단위 테스트: 비회원·검수·계정 슬롯 분리, 변경된 revision의 충돌 판정, 기기 간 시계 차이, 압축 저장본 복원과 손상/부분 저장본 거부.
- 실제 Firebase Firestore/Storage 에뮬레이터: 다른 사용자 및 비로그인 사용자의 읽기/쓰기 거부, 저장 목록 조회 거부, 잘못된 manifest와 MIME 거부, 기존 압축 파일 변경 거부.
- 두 동시 작성자가 같은 이전 revision으로 저장하면 한 명만 커밋되고 다른 작성자는 충돌을 받는다. 커밋된 세계를 다시 읽어 확인하고 계정이 바뀌면 이전 UID의 작업을 거부한다.
- 실제 앱 브라우저 검증: 에뮬레이터 Alice 로그인 → `Alice의 행성` 생성 → 클라우드 저장 성공 → 로그아웃 시 빈 비회원 화면 → Bob 로그인 시 빈 계정 → Alice 재로그인 시 자신의 행성 복원.
- Cloudflare `wrangler deploy --dry-run`이 정적 자산과 Custom Domain 설정을 정상적으로 처리했다.

2026-10-10 운영 연결: `sandsphere-app`의 서울 Firestore와 이메일·Google 로그인 설정을 활성화했다. Cloudflare 계정과 활성 `sandsphere.app` 도메인을 확인했다. 전용 Gitea runner에 Firebase·Cloudflare 인증을 연결하고 공개 Web App 설정을 secrets로 등록했다. 실제 HTTPS 앱의 로그인·저장·복원 검증은 배포 후 확인한다.

format 2 저장 추가 검증: Firestore 분할 조각의 사용자 격리, 변경·목록 조회·크기 초과 거부, 현재/이전 revision 삭제 거부, 동시 작성 충돌, 512 KiB보다 큰 실제 압축 저장본 왕복, 세 번째 저장 후 첫 번째 revision 정리. 에뮬레이터 테스트 5개 통과.

검증 화면: `artifacts/account-cloud-save.jpg`.

운영 검증 추가: `https://sandsphere.app`에서 HTTPS 200과 배포 태그·커밋을 확인했다. 임시 검증 계정으로 운영 Firebase SDK 로그인 → 실제 Firestore 저장 → 다른 UID 접근 거부 → 로그아웃·재로그인 후 원본 복원을 통과했다(`tests/account-live.test.ts`, 명시적 opt-in). 일반 CI에서는 이 운영 테스트를 건너뛴다.

2026-10-10 브라우저 범위: 배포한 앱의 초기 화면과 계정 UI는 확인했다. Codex 내장 브라우저에서 Google API의 로그인 POST가 CORS preflight 성공 뒤 `ERR_ABORTED`로 중단되었고, 일반 Chrome 제어는 연결되지 않았다. 당시에는 운영 UI의 로그인 완료를 확인하지 못했다. Google provider 활성화, 허용 도메인, 인증 handler HTTPS 200은 확인했다.

2026-10-11 운영 Google 로그인·저장·재로그인 검증: 실제 macOS Safari에서 `https://sandsphere.app/`의 계정 버튼 → Google 계정 선택 → 기본 이름·프로필·이메일 로그인 동의 → `a7garden@gmail.com` 로그인 완료를 확인했다. 계정에 기존 게임이 없음을 확인한 뒤 물 행성 `Google 복원 확인 1011`을 만들고 일시 정지했다. `지금 저장`을 눌러 `클라우드에 저장했습니다. · 오전 12:27:54` 표시를 확인했다. 로그아웃 후 빈 비회원 생성 화면과 비회원 계정 표시를 확인하고, 동일 Google 계정으로 다시 로그인했다. 별도 복원 선택 없이 같은 행성이 돌아왔으며 다음 값이 저장 전후 일치했다: 행성 이름, 일시 정지 상태, 액체 물 61,476.3 kg, 구름 물·얼음 3.78 kg, 발견 기록 2개. 재로그인 계정과 클라우드 저장 완료 표시도 확인했다. 같은 Safari 프로필에서의 재로그인 검증이며, 브라우저 저장소를 지우거나 새 기기를 사용한 검증은 아니다. 앱 코드나 배포 설정을 변경하지 않았다. 테스트 행성은 해당 계정에 그대로 보관했다.

운영 UI 증거: `artifacts/google-cloud-saved.png`, `artifacts/google-logged-out.png`, `artifacts/google-restored-world.png`, `artifacts/google-restored-account.png`.

최초 배포 직후 Mac mini의 시스템 DNS가 새 도메인의 음성 캐시를 유지해 마지막 상태 검증이 실패했다. 검증 스크립트는 시스템 IPv4 조회 실패 시 Cloudflare 공개 DNS로 조회하고 동일 호스트의 TLS 인증서를 검증한다. 시스템 DNS 설정은 변경하지 않는다.
