# 전체 성능 최적화와 배포 작업

2026-10-23 시작. 사용자가 성능 연구 후 전체 최적화 구현과 운영 배포를 요청했다.
연구 기준은 `PERFORMANCE_RESEARCH_2026-10-23_KO.md`이며, 시작 후보는
`0.7.0-alpha.18`, HEAD `02d53d7bb7111ed2a858599dd296489db9246417`의
미커밋 통합 작업 트리다. 이전 변경은 제거하거나 옛 HEAD로 되돌리지 않는다.

## 완료 조건

- 저장: 진행된 일반/거대 행성 8개와 두 모드·telemetry를 기존 용량 한도에서
  무손실 왕복한다. 재고·열 잔여·복사 캐시·진행 상태를 버리지 않는다.
  이전 로컬·클라우드 저장 읽기, 원자적 쓰기·충돌·종료 복구를 유지한다.
- 시뮬레이션: 같은 물리 시간 간격·격자·공통 법칙·Float64 정밀도와 기존
  보존 허용치를 유지한다. 반복 할당·동일 단계 중복 계산을 줄이고,
  CPU/Worker/배경/재개 동등성 및 실패 롤백을 검증한다.
- 화면: 기존 hex·해안·대기·구름·단면 품질과 입력을 유지하며 불필요한
  업로드·표면 재구축·관측 집계를 줄인다. 실제 게임을 다시 검사한다.
- 로딩: 계정 범위·충돌·복구 결정을 보존하면서 독립 준비를 병렬화하고
  불필요한 초기 의존성과 GPU 초기화를 줄인다.
- 성능: 동일 하네스·상태·warmup/sample 조건에서 전후를 비교한다.
  브라우저/CPU 벤치마크는 root가 독점 실행한다. 1× 계산 33.33ms 및
  UI 60fps 16.67ms는 추적 목표이며, 이번 패치가 달성했다고 미리 가정하지 않는다.
- 배포: 전체 검사·저장 회귀·규칙 검사·빌드·실제 게임을 확인하고 SemVer
  정식 릴리즈를 Gitea에서 발행한다. `release.json`의 태그와 커밋으로 운영
  전달을 확인한다. 이전 배포와 새 저장의 호환 복구 절차를 남긴다.

## 담당과 상태

모든 구현 담당은 game-development-harness의 기본인 gpt-6.1-sol / high다.
root가 요구사항·후보 고정·독립 수용·성능 계측·릴리즈를 담당한다.

| 요구사항 | 담당 | 파일 경계 | 현재 상태 | 다음 완료 조건 |
| --- | --- | --- | --- | --- |
| 복사 scratch, staged 물성, 깊은 대기 할당/수송 | physics_opt | layeredAtmosphere, spectralRadiation, deepAtmosphere | 구현 중 | 기존 상태 golden·회귀·전후 처리량 |
| 무손실 저장, 캡처, 자동 저장, 초기 로딩 | storage_opt | account, browserStorage, session, main 저장/boot, telemetry revision | 구현 중 | 8행성·옛 저장·장애·실제 브라우저 |
| Worker 소유권, CPU 라우팅, 배경 상주/병렬 | runtime_opt | gpu, solver worker/protocol, system, CpuSolver transaction seam | 구현 중 | detach·실패 재시도·배경 동등성 |
| 표면/단면 dirty, 해안 버퍼, 관측 집계 | render_opt | render, 관련 ui 관측 | 구현 중 | 구조 회귀·실제 편집·표면 프레임 |
| 성능/통합/보안 규칙/릴리즈 | root | 증거·패키지·변경 기록·운영 | 준비 중 | 고정 후보 검사 및 운영 검증 |

초기 병렬 구현 직후 비무시 파일 547개를 `/tmp/sandsphere-before-optimization-20261023.tar.gz`에
백업했다. 이 원본에는 먼저 편집된 spectralRadiation과 새 golden 검사가 포함되어 있었다.
검증된 수정 전 spectral 사본으로 보완하고 새 검사를 제외한
`/tmp/sandsphere-optimization-reference-20261023.tar.gz`의 기존 517개 파일은
이전 연구의 원본 해시와 모두 같다. 두 아카이브를 모두 보존한다.
파일 해시·Git 상태와 보완 근거는 `performance/2026-10-23/optimization-baseline.json`,
`optimization-reference.json`에 있다.
상태 전이는 구현 → 개별 검사 → 독립 수용 → 게임 통합 → 배포로 기록한다.

## 구조 실험의 범위

연구 P3의 WASM SIMD/대기 GPU 상주는 앞선 개선 뒤의 비교 실험이다.
CPU와 같은 정밀도·수지·재개 계약과 실제 성능 이점을 입증한 경우에만
운영 경로로 선택한다. 임의 정밀도 축소나 GPU 이름만 유지하는 표시는 하지 않는다.
모바일 실기기·배터리·장시간 열 안정성은 현재 장비에서 검증하지 않은 범위로 남긴다.

## 결과

구현과 검증 결과를 아래에 계속 기록한다. 아직 배포 완료를 뜻하지 않는다.
