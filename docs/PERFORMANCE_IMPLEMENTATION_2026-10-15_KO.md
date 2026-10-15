# Sandsphere 성능 개선 실행 기록

작업일: 2026-10-15 · 브랜치: `codex/performance-20261015` · 공개 배포/원격 푸시 없음

## 보존한 기준

- 원본 `/Users/garden/Workspace/Projects/sandsphere`, 브랜치 `codex/animal-ai`, HEAD `02d53d7`의 기존 미커밋 133개 경로를 체크포인트 `c69e291d749c04a952fb73b5061b99e95dd92b72` (`codex/performance-checkpoint-20261015`)에 보존했다.
- 원본 작업 트리와 인덱스를 바꾸지 않았다. 구현은 `/Users/garden/Workspace/Projects/wt/sandsphere-performance-20261015`에서 수행한다. 패치·해시는 원본의 `artifacts/performance-checkpoint-20261015/before.json`, `changes.patch`에도 있다.
- 측정 장비·런타임은 연구 보고서와 같고, 구현 직전 동일 하네스를 다시 실행했다. `scripts/benchmark-performance.mjs`는 현재 worktree 소스를 로드하며 GPU/브라우저 FPS를 측정하지 않는다.
- 브라우저 검증은 Mac 잠금으로 아직 미수행이다. 잠금·승인·보안 설정을 변경하거나 우회하지 않는다.

## 1단계 — 무손실 저장과 중복 작업 제거

- 길이가 긴 숫자 배열을 IEEE-754 Float64 이진 포장 후 gzip으로 저장한다. 재고·기후 캐시·관측 숫자를 양자화하지 않는다. 모델 저장 v11·대기 v6, 64MiB 원문·20MiB 압축 한도, 계정 충돌·리비전 규칙은 유지한다.
- 새 코드는 이전 gzip JSON과 IndexedDB 객체 저장을 계속 읽는다. 새 형식은 이진 전송 포장 버전이며 이전 앱이 새 포장을 읽는 역방향 호환성까지 제공하지는 않는다.
- 현재 v11 상태에 불필요한 Float32 변환·깊은 대기 이중 복사를 줄였다. 음수 반올림 수리가 필요한 저장은 기존 마이그레이션 경로를 사용한다.
- 정산할 명령·낙하가 없는 세션은 그림자 기후 계산기를 새로 생성하지 않고, 저장마다 활성 행성을 두 번 정산하던 경로를 한 번으로 합쳤다.

같은 조건(2,562셀 목성, 14×1/30게임초 진행, 각 모드 4개씩, 관측 이력 제외)의 결과:

| 지표 | 변경 전 | 1단계 후 |
| --- | ---: | ---: |
| 압축 크기 | 21,306,431B — 한도 초과 | 16,650,091B — 한도 이내 |
| 저장 준비 3회 평균 | 540.99ms | 167.49ms |
| 포장/읽기 3회 평균 | 기존 JSON 전송 | 70.61ms / 9.36ms |
| 새 포장 원문 | 기존 JSON 55,086,990B | 31,331,488B |
| encode 경과 | 연구의 gzip 약 1,772.8ms | 포장+gzip 588.79ms |

정상 재개 및 무손실 비교를 포함한 관련 39개 검사, TypeScript, 버전 검사와 `git diff --check`가 통과했다. 전체 회귀는 통합 단계에서 다시 수행한다. 포장 비용·IDB 실제 프레임 지연·최대 관측 이력이 포함된 한도는 후속 단계에서 계속 검증한다.

증거: `docs/performance/implementation-2026-10-15/before.json`, `stage1-save-metrics.json`, `stage1-tests.json`.
