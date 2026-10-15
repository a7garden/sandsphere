# Sandsphere macOS 로컬 성능 최적화 조사

조사일: 2026-10-15 · 대상: 현재 미커밋 작업 상태 `0.7.0-alpha.12` · 연구만 수행

## 1. 결론과 우선순위

가장 먼저 다룰 대상은 **대기 계산 처리량과 전체 저장본 생성 비용**이다. 현재 2,562셀의 젖은 해안에서 CPU 물리 한 단계는 평균 **163.43ms**, 목성은 **222.19ms**였다. 기본 1배속의 단계 예산 33.33ms보다 각각 약 4.9배, 6.7배 길다. Worker가 화면 응답성을 보호하더라도 계산 처리량 자체는 이 비용의 영향을 받는다. 이는 Node에서 현재 소스를 실행한 결과이며, 실제 브라우저 FPS나 WebGPU 결과는 아니다.

**클라우드 저장 크기 제한도 실제로 재현했다.** 두 모드에 목성 4개씩을 둔 유효한 합성 저장본을 14단계 진행하면, 관측 기록 없이도 압축본이 약 20.32MiB가 된다. 실제 `encodeSave()`가 20MiB 한도를 이유로 거부했다. 사용자의 실제 저장본이나 외부 계정을 읽거나 쓰지 않았다.

권장 순서는 다음과 같다.

1. **P0 — 저장 용량 회귀와 저장 준비의 긴 동기 작업을 함께 해결한다.** 진행한 다중 행성·관측 이력까지 포함하는 회귀 기준을 먼저 만든다.
2. **P1 — 공통 열역학 계산과 대기 수송의 반복 작업을 줄인다.** 젖은 행성에서 대기 dynamics 약 59.80ms, combustionStep 약 31.49ms/단계가 측정됐다.
3. **P1 — 배경 행성의 매 단계 일반 배열 스냅샷 생성과 직렬 실행을 줄인다.** 대기 snapshot 생성만 약 13.13ms/회이며, 현재 배경 행성마다 호출된다.
4. **P1 — 초기 로딩에서 큰 과학 데이터와 Firebase의 의존 경계를 분리한다.** 앱 정적 JS 그래프는 gzip 2.10MiB이며 별도 Worker도 gzip 1.37MiB다.
5. **P2 — 렌더링 부분 갱신, 불필요한 대기 객체 할당, Worker 복사량을 개선한다.** 렌더링의 실제 순위는 브라우저 측정 후 확정한다.

## 2. 조사 기준과 기존 작업 보존

- 정본 경로: `/Users/garden/Workspace/Projects/sandsphere`
- 브랜치: `codex/animal-ai`
- HEAD: `02d53d7bb7111ed2a858599dd296489db9246417` — `Release 0.6.1 with mobile brush input and compact controls`
- 작업 트리 패키지: `0.7.0-alpha.12`. HEAD만으로 현재 구현을 설명할 수 없는 상태다.
- 시작 시 이미 `src/main.ts`, 렌더러, CPU/GPU 물리, 저장, UI, 테스트, 문서 등 다수의 수정·미추적 파일이 있었다. 이번 수치는 그 변경을 모두 포함한 현재 소스의 수치다. 이전 릴리즈와의 성능 비교로 해석하지 않는다.
- `/Users/garden/Workspace/Projects/AGENTS.md`, 저장소 `AGENTS.md`, `docs/SIMULATION_PRINCIPLES.md`를 확인했다. 국소 법칙, 재고·에너지 수지, 같은 시간 적분, 저장 재개와 백엔드 일관성을 유지하는 최적화를 우선한다.
- 사용자 요청에 따라 제품 코드·패키지·버전·기존 문서를 수정하지 않았고 커밋·푸시·배포·외부 설정 변경·설치를 하지 않았다. 이번 보고서와 조사 증거만 별도 파일로 추가한다. 저장소의 일반 커밋 지침보다 이번 연구의 명시적 커밋 금지 요청을 따른다.
- 조사 시작 시 소스·테스트·스크립트·문서·패키지 등 371개 파일의 SHA-256을 기록했다. 종료 전 같은 파일을 다시 비교한다. 로우폴리 에셋 수신 작업과 그 파일은 조사·수정 대상에 넣지 않았다.

환경은 Apple M4 Max, 논리 CPU 16개, RAM 64GiB, macOS 27.0.1 arm64, Node 26.9.0, npm 11.19.1이다. README 권장 Node는 24이므로, 추후 대표 브라우저 및 Node 24에서도 비교해야 한다. package.json 기준 의존성은 Babylon.js 9.30.0, Firebase 13.0.0, Vite 8.3.4, Vitest 5.0.3, TypeScript 7.0.2다.

**측정 한계:** Mac 잠금 때문에 Computer Use가 앱·브라우저를 제공하지 않았다. 따라서 실제 UI 프레임 시간, WebGPU/WebGL GPU 시간, draw call, 모바일, 네트워크 RTT, IndexedDB 지연과 장시간 브라우저 힙은 측정하지 못했다. 기존 브라우저 실험 페이지는 소스를 확인했지만 실행 성공으로 기록하지 않는다. 유료 작업이나 새 권한이 필요한 설치는 진행하지 않았다.

## 3. 실제 기술 스택과 실행 경로

Sandsphere는 프레임워크의 가상 DOM을 쓰지 않고 직접 DOM을 갱신하는 TypeScript 앱이다. Babylon.js가 3D 장면을 렌더링하고 WebGPU/CPU가 물리를 실행하며 Firebase는 계정·클라우드 저장을 담당한다.

| 경로 | 현재 구현과 비용이 발생하는 지점 | 근거 |
| --- | --- | --- |
| 초기화 | `createSphere(4)`로 2,562셀 생성 → CPU 초기 상태 → `PlanetView.create()` → Worker 우선, 불가 시 메인 GPU/CPU | `src/main.ts:109,117,940–949` |
| 프레임 | 카메라·동물·날씨 애니메이션과 `scene.render()`; 물리와 별도로 실행 | `src/main.ts:958–969`, `src/render/planet.ts:878` |
| 물리 | `PHYSICS_DT=1/30`; 기후 켜짐에서는 한 번에 1단계; 현재 단계가 완료되어야 다음 활성·배경 계산 진행 | `src/sim/clock.ts:2`, `src/main.ts:957,965` |
| Worker | 매 요청 state·commands·lift·전체 climate 체크포인트 복사 → Worker replace/restore → 계산 → 결과 다시 복사·전달 → 메인 restore | `src/sim/workerSolver.ts:47–57`, `src/sim/solver.worker.ts:23–29` |
| 일반 대기 | 11층, 9성분; 물리 한 단계는 2대기초이며 보통 최대 1대기초씩 2회 적분, CFL 조건이면 더 세분화 | `src/sim/layeredAtmosphere.ts:26–41,534–557` |
| GPU | 지표 전처리·완료와 대기는 호스트 CPU 코드. 지표 GPU 결과를 `mapAsync`로 읽은 뒤 호스트 기후 계산 | `src/sim/gpu.ts:63–119`, `src/sim/model.ts:374–381` |
| 배경 행성 | 모드당 최대 4개. 활성 다음에 다른 행성을 순차 await하며 매 단계 일반 배열 state·climate snapshot 게시 | `src/sim/system.ts:10,85–110` |
| 표면 갱신 | dirty 물리 결과를 최대 15Hz로 합침; 전체 지형·물·열 버퍼와 해안 메시 갱신 | `src/render/budget.ts:10–24`, `src/render/planet.ts:450–615` |
| 관측·UI | 약 0.2초마다 관측 DOM과 활성 state 배열 갱신. Telemetry는 기본 1게임초마다 표본 생성; 대시보드는 닫히면 render 생략, 열리면 500ms 제한 | `src/main.ts:145–156,969`, `src/ui/planetDashboard.ts:77–78` |
| 저장 | 약 5초마다 모든 모드의 행성과 telemetry를 capture·validate·upgrade·IDB 저장; 계정 연결 시 최소 60초 간격 클라우드 업로드 | `src/main.ts:406–421,969` |
| 네트워크 | JSON → gzip → 512KiB Firestore 파트, 8개씩 배치; 현재·직전 리비전 유지, manifest 트랜잭션 | `src/account/firebase.ts:28–130` |

기존 최적화도 있다. Retina 버퍼는 약 200만 픽셀로 제한되고, 표면 갱신은 합쳐지며, 바뀐 법선만 재계산한다. 동물은 종류별 thin instance를 사용하고 종류당 256개 표시로 제한된다. 대기 복사는 typed checkpoint를 쓰고 복사본의 버퍼를 transfer한다. 따라서 이미 있는 제한이나 instancing을 새 개선안처럼 제시하지 않는다.

## 4. 측정된 병목

### 4.1 CPU 계산 처리량

현재 소스를 Vite SSR로 로드하고 각 독립 시나리오에서 `CpuSolver.advance(1/30, …)`를 호출했다. 첫 단계 1회, 준비 2회, 정상 단계 8회를 측정했다. GPU·렌더·네트워크·사용자 저장은 포함하지 않는다. 전체 테스트와 빌드가 끝난 뒤 실행했다. 첫 중단 실험에서도 젖은 행성 평균 163.52ms였고, 수정된 진단 하네스 재실행은 163.43ms였다.

| 시나리오 | 셀 | 첫 단계 ms | 정상 평균 ms | 표본 P95 ms | CPU만 고려한 1배속 대비 상한 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 건조 모래·질소 | 162 | 69.09 | 11.19 | 16.17 | 2.98× |
| 건조 모래·질소 | 642 | 132.50 | 38.56 | 40.77 | 0.86× |
| 건조 모래·질소 | 2,562 | 461.19 | 154.07 | 160.10 | 0.22× |
| 젖은 해안 | 2,562 | 505.11 | 163.43 | 167.17 | 0.20× |
| 메탄 대기·중력 0.3 | 2,562 | 555.74 | 161.92 | 171.53 | 0.21× |
| 목성 프리셋 | 2,562 | 238.70 | 222.19 | 249.21 | 0.15× |
| 건조 모래·질소 · 기후 끔 | 2,562 | 33.40 | 20.41 | 24.18 | 1.63× |

상한은 `33.333 / 평균 단계 ms`다. 실제 앱에는 Worker 왕복·렌더·배경 행성·저장 비용이 추가되므로 실시간 재생 속도 보장값은 아니다. 정상 표본은 8개로 작아 P95는 사실상 최대값에 가깝다. 장기 열·유체 상태와 CFL 세분화에 따른 변화도 별도 검증이 필요하다. 기후 끔은 비용 분리를 위한 진단 대조군이며 현재 앱의 최적화 결과가 아니다.

젖은 행성에 3단계 동안 함수별 타이머를 붙인 진단의 전체 평균은 168.71ms였다. 이때 `climate.step` 144.45ms, 그 안의 `air.advance` 122.93ms, 그 안의 dynamics 59.80ms·combustionStep 31.49ms·radiation 9.60ms·phase 2.44ms였다. **부모·자식 시간은 중첩되므로 합산하지 않는다.** 목성의 다른 단계 진단은 dynamics 147.02ms·radiation 25.94ms·equilibrateClouds 32.22ms였다. 진단 타이머 오버헤드와 상태 진화를 고려해 순위 근거로 사용한다.

젖은 행성의 추가 8단계 CPU 샘플 프로파일에서는 `phaseEnergy`의 self sample 비중이 합계 약 16.79%, `queue` 6.81%, `layerCapacity` 5.60%, `layerEnergy` 4.53%였다. Vite 변환 프레임·익명 함수·프로파일러 오버헤드도 포함된 샘플이므로 이 비중을 그대로 개선율로 쓰지 않는다. 다만 열용량·상/화학 에너지의 반복 순회와 대기 수송이 우선 검토 지점임을 뒷받침한다.

### 4.2 메모리 복사와 배경 행성 스냅샷

2,562셀의 일반 대기 체크포인트는 **5,236,728B(4.99MiB)**였다. 복사 평균은 젖은 행성 0.28ms, restore 0.10ms로, 이 Mac의 정상 계산 163.43ms보다 훨씬 작다. 전체 Worker 왕복 시간은 측정하지 못했으므로 단순 복사를 주 병목으로 단정할 근거는 없다.

반면 일반 배열을 만드는 `climate.snapshot()`은 젖은 행성 **13.13ms/회**, 건조 13.72ms, 메탄 14.36ms였다. 배경 행성은 `stepAsync`의 매 단계에서 이 작업을 UI 쪽에서 수행한다. 배경 3개가 각각 생성하면 약 39ms라는 **호출 비용 합의 추정치**가 된다. 실제 브라우저의 프레임 정지 시간을 실측한 수치는 아니다. 활성 Telemetry 표본도 기후 전체 snapshot을 만든다.

CPU Solver 하나에서 도달 가능한 고유 typed array 버퍼는 **22,711,410B(21.66MiB)**였다. `WeatherClimate` 그래프는 19,788,168B이고, 일반 대기와 깊은 대기 객체를 모두 즉시 생성한다. 일반 대기 하위 그래프는 11,446,176B, 깊은 대기는 7,634,832B다. 이 값들은 공유 격자도 포함하므로 하위 값끼리 합산하면 안 된다. JS 객체·일반 숫자 배열·테이블·GPU 버퍼를 포함한 총 힙이나 메모리 누수 측정은 아니다.

`climateTransferBuffers()`에는 `sootRadiationCache` 225,456B, `sootLiftCarry` 20,496B가 없다. 이 두 배열은 메시지에 들어 있으므로 일반 structured clone으로 전달된다. 복사 비용 후보이지 데이터 누락으로 확인된 버그는 아니다. [ArrayBuffer transfer는 소유권을 이전하며 원본을 detach한다](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects). 살아 있는 렌더·저장 버퍼를 곧바로 transfer하는 최적화는 현재 커밋·롤백 계약을 깨뜨릴 수 있다.

### 4.3 저장 준비·직렬화와 용량 한도

현재 소스의 `prepareSystemSave`를 호출하고 같은 내용에 `structuredClone`, JSON stringify, `CompressionStream('gzip')`를 따로 측정했다. 준비·clone·stringify·gzip은 각각 3회 평균이다. 같은 상태를 모드당 최대 4개, 총 1/4/8개로 복제한 **합성 데이터이며 telemetry는 제외**했다.

| 상태 | 행성 수 | JSON MiB | gzip MiB | prepare ms | clone ms | stringify ms | gzip 경과 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 젖은 해안 | 1 | 6.44 | 1.97 | 19.53 | 39.83 | 7.50 | 172.08 |
| 젖은 해안 | 4 | 25.78 | 7.86 | 55.87 | 162.51 | 29.53 | 689.03 |
| 젖은 해안 | 8 | 51.56 | 15.72 | 98.81 | 351.20 | 60.46 | 1388.93 |
| 목성 | 1 | 6.57 | 2.54 | 70.92 | 26.44 | 7.92 | 221.85 |
| 목성 | 4 | 26.27 | 10.16 | 265.20 | 111.19 | 32.17 | 890.24 |
| 목성 | 8 | 52.54 | 20.32 | 547.33 | 251.18 | 63.93 | 1772.80 |

`prepare`는 유효성 검사와 저장 업그레이드 비용이며 앱의 동기 실행 경로에 있다. 이 수치에는 `captureSystem`, `snapshotSurface`, telemetry archive, 실제 IDB 트랜잭션은 포함되지 않는다. `clone`은 IDB가 사용하는 복사의 비용을 가늠하는 대조 실험이다. 실제 IDB 지연과 동일하지 않고 전체 저장 시간에 그대로 합산할 수도 없다. gzip은 비동기 스트림의 경과 시간이므로 전부 UI 정지 시간이라고 해석하지 않는다.

**확정 재현:** 실제 목성 프리셋을 `CpuSolver`로 14×1/30게임초 진행 → 4개 행성씩 두 모드 구성 → `prepareSystemSave` 통과 → `validSystem === true` → 실제 `encodeSave()` 호출 → `압축한 저장 데이터가 최대 크기(20MB)를 넘었습니다.`. 저장 원문은 55,087,126B, 허용 압축 크기는 20,971,520B였다. 이는 가능한 합성 다중 행성 저장의 실패를 확인한 것이며 모든 저장이 실패한다는 뜻은 아니다.

기존 `giant-save-size.test.ts`는 초기 목성·토성의 혼합 8개 상태를 검사한다. 초기 상태 통과만으로 유체 계산이 진행된 상태의 압축 크기를 보장할 수 없다. 관측 이력과 다른 모드 이력까지 포함해 정상 플레이 후의 저장 크기와 재개를 검증하는 것이 필요하다. 한도를 키우면 전송·저장 비용과 보안 규칙에도 영향이 있으므로 먼저 표현·증분·캐시 저장 전략을 검토한다.

### 4.4 초기 번들·네트워크

같은 Vite 타깃·두 HTML 입력을 사용하고, 산출물과 캐시는 `/tmp`에 뒀다. 환경 파일은 읽지 않았다. 빌드는 9.02초에 성공했으며 대형 청크 경고가 있었다. 측정한 압축은 로컬 gzip/Brotli이고 실제 서버의 Content-Encoding, 캐시 적중, 전송 시간은 아니다.

| 산출물 | 원본 B | gzip B | Brotli B |
| --- | ---: | ---: | ---: |
| planet 공용 JS | 4,167,999 | 1,898,639 | 1,667,772 |
| solver Worker JS | 2,338,850 | 1,434,260 | 1,309,760 |
| app JS | 836,435 | 254,215 | 213,464 |
| app CSS | 203,045 | 34,492 | 28,592 |
| 앱의 정적 JS 그래프 · 21청크 | 5,185,697 | 2,205,347 | 1,926,687 |

Worker JS는 별도 로딩이며 정적 JS 그래프 수치에는 들어 있지 않다. 공용 planet 청크의 443개 모듈에는 Babylon.js, 렌더러, 시뮬레이션, `ecckd-32.json`이 함께 있다. app 청크에는 정적 Firebase 의존성이 들어 있다. 청크 모듈별 renderedLength는 압축 전 메타데이터이므로 실제 minify 후 파일 크기와 합산해 비교하지 않는다.

ecCKD JSON은 2,220,399B로, 이미 **Float32 데이터의 base64 포장**이다. 디코딩 후 현재 Float64 테이블은 약 3,321,456B이며 main과 각 Worker realm에서 초기화될 수 있다. 원본 JSON gzip 1,392,674B, 원래 Float32 바이트를 이어 붙인 gzip은 1,314,368B였다. 메타데이터를 제외한 실험 기준 약 5.6% 차이이므로 포장 형식 변경만으로 네트워크 비용이 크게 줄어든다고 주장할 수 없다. 우선 검토할 것은 같은 과학 데이터를 main과 Worker에 중복 포함·초기화하는 의존 경계다.

클라우드 저장은 512KiB씩, 8개 파트 단위로 쓰므로 8개 젖은 행성의 15.72MiB 압축본은 약 32파트이고, 목성 예시는 한도 때문에 업로드 전에 중단된다. 업로드가 60초마다 가능하다는 소스 사실은 확인했지만 요청 수·과금·실제 RTT는 계정에 접속하지 않아 측정하지 않았다.

## 5. 소스에서 확인했지만 시간은 측정하지 못한 후보

| 후보 | 근거와 현재 판단 | 다음 측정 |
| --- | --- | --- |
| 표면의 전체 버퍼 업로드 | `PlanetView.update`가 온도만 바뀌어도 지형·물·열의 position/normal/color 등을 전체 갱신하고 젖은 해안 메시를 `applyToMesh`로 재작성한다. 기본 격자의 명시적 9개 업로드 배열 합은 약 2.52MB/회로 계산된다. 최대 15Hz에서는 약 37.8MB/s의 이론적 업로드량이며 해안 재구축은 별도다. GPU 지연 실측은 없다. | 기존 surface lab의 온도 변화 / 붓기 각각 refresh·render·frame P95, 업로드 바이트 |
| WebGPU readback | 매 단계 `queue.submit` 뒤 `mapAsync`로 지표를 읽고 호스트에서 대기를 계산한다. 깊은 대기 자체도 호스트 코드다. GPU 전환만으로 이번 대기 CPU 비용이 제거되지는 않는다. | dispatch·map 대기·finishSurfaceStep·Worker 왕복 분리. [mapAsync의 매핑 완료와 GPU 사용 제약](https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer/mapAsync) 참고 |
| 중복 picking | 앱의 명시적 picking은 hover 시 약 33ms 제한이 있으나 Babylon 기본 pointer move picking을 끄는 설정은 발견하지 못했다. 추가 비용의 존재·크기는 미측정이다. | 포인터 정지 / hover / 큰 브러시 별 pick 호출수·시간, section 입력 회귀 |
| 관측 DOM과 전체 state 배열 | 약 5Hz로 DOM·전체 state 일반 배열을 갱신하고, 관측 지점에서 복사·정렬·복사열 진단을 호출한다. 캠페인 과제도 함께 갱신된다. | observerUpdate·layout·style 시간, 닫힌 패널과 캠페인/샌드박스 비교 |
| 반투명 대기·구름 fill rate | 대기 구면·구름·강수·해안·고밀도 창에서 픽셀 비용이 생길 수 있다. 이미 픽셀 제한이 있다. | 고정 상태에서 대기/구름 ON/OFF, 해상도별 GPU 시간 |
| Worker/행성 수 증가의 메모리 | main의 WeatherClimate와 각 Worker에 대기 객체가 있고, 비활성 영역도 할당된다. 관측 일반 배열과 스냅샷이 추가된다. | 행성 1→4, 모드 왕복·행성 전환 20회, GC 후 힙·ArrayBuffer·GPU 자원 추세 |

[Babylon 공식 최적화 문서](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene)는 인스턴싱·picking·bounding 갱신을 측정할 지점을 설명한다. 이 앱은 이미 [thin instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances)를 사용한다. 카메라·단면·물리 상태가 바뀌는 장면 전체에 freeze를 적용하기보다 정적 부분과 변경 원인을 먼저 구별해야 한다.

## 6. 개선안별 기대 효과·비용·위험·검증

아래 효과는 이번 조사에서 구현해 달성한 수치가 아니다. 관측된 비용을 기준으로 잡은 목표 또는 비용 상한이다. 비용은 저장소에 익숙한 개발자 1명의 대략적 작업일이며 리뷰·실기 검증에 따라 달라진다.

| 순위 | 구체적 개선 | 기대 효과와 근거 | 비용 | 위험 | 검증 방법 |
| --- | --- | --- | --- | --- | --- |
| **P0** | 진행한 다중 행성과 telemetry를 포함해 저장 표현·한도를 설계한다. 재계산 가능한 캐시는 재개 동등성을 보장할 때만 제외하고, 숫자 재고는 손실 없이 보존한다. | 이번 20MiB 초과 재현을 해소하고 정상 플레이 후 클라우드 저장 가능 범위를 확보. 사용자 데이터 손실을 막는 것이 먼저다. | 2–5일 | 저장 형식 마이그레이션·리비전 충돌·캐시 초기화로 궤적 변경 | 1/4/8행성, 두 모드, 충분한 진행·연소·이력 포함 raw/gzip 한도와 byte/수지·저장 재개; 기존 1–11버전 읽기·계정 충돌 검사 |
| **P0** | 저장 직렬화·검증·압축을 Worker 소유 상태에서 수행하고 IDB용 스냅샷을 revision 기준으로 한 번 만든다. 변경이 없으면 5초 주기의 전체 재생성을 생략한다. | 목성 8개의 prepare 약 547ms 및 반복 clone 비용이 UI에 집중되는 경로를 줄임. 전체 경과 시간 감소율은 미확정. | 2–4일 | 계산 중 반쯤 저장, command 중복, telemetry 시점 불일치 | 현재 완료 상태의 원자적 저장·명령 exactly-once·실패 복구·5초 타이밍과 browser Long Task 비교 |
| **P1** | mass/열용량/상·화학 에너지의 중복 순회를 줄이고, 같은 수송 단계에서 변하지 않는 값을 stage-local 캐시한다. 배열·객체 할당을 줄인다. | dynamics 약 60ms와 phaseEnergy self sample 16.79%가 대상. 1차 목표 전체 CPU 단계 10–25% 단축을 비교 실험으로 확인. 목표일 뿐 보장 아님. | 2–4일 | 질량 변동 뒤 stale cache, 연산 순서·반올림 변화 | dry/wet/methane/fire/giant 결정적 digest, 질량·원소·에너지 수지, 작은 dt 대조, CPU/Worker/GPU 및 롤백 |
| **P1** | combustionStep의 실제 무반응 셀을 물성·반응물·온도 조건으로 빠르게 판정한다. 열분해·숯·CO·그을음 경로도 포함한다. | 젖은 행성에서 약 31.49ms/단계가 대상. 이 경로 50% 절감이면 같은 진단 조건 전체의 약 9% 절감이라는 산술 추정. | 1–3일 | 산소 없는 열분해나 소량 반응 누락, 반올림이 달라지는 no-op 생략 | 무산소·무연료·흡열/불완전 연소·재산화·plume 대조, 에너지 장부와 저장 재개. 단순 산소 유무만으로 전체 생략하지 않음 |
| **P1** | 배경 행성 상태를 Worker에 유지하고 typed 관측 스냅샷을 일정 주기로 게시한다. 일반 배열 변환은 저장 경계로 모은다. 독립 행성 계산은 제한된 동시 실행을 검토한다. | 배경당 snapshot 약 13ms/단계와 직렬 대기를 줄임. 시뮬레이션 단계·질량·시간은 그대로 보존. 실제 4행성 향상률은 미측정. | 2–4일 | 시점이 다른 관측·저장, 활성 전환·취소 처리, CPU 경쟁 | 활성/배경 동일 시간 결과·행성 전환·명령·실패 보존; 1/2/4행성 처리량과 UI P95·배터리 |
| **P1** | 상태 상수·타입·표시용 읽기 모델과 실제 솔버/과학 데이터의 import 경계를 분리하고, Firebase 계정 기능은 필요한 시점에 로드한다. | main/Worker에 반복 포함되는 2.22MB 과학 모듈과 정적 Firebase의 초기 평가·네트워크를 줄일 여지. 파일을 청크로 나누는 것만으로 총량이 줄지는 않음. | 2–4일 | 비동기 초기화·fallback·순환 import·옛 캐시와 새 Worker 불일치 | [Vite 8 Rolldown 분할 계약](https://vite.dev/guide/build)에 맞춘 빌드 그래프, cold/warm cache 로드·게스트·계정·Worker 불가 경로 |
| **P2** | 일반/깊은 대기와 main의 표시 전용 상태를 필요할 때 할당하고 buffer pool을 도입한다. 누락된 soot 배열의 transfer도 검토한다. | 깊은 대기 미사용 영역 약 7.6MB 하위 그래프 등 감소 여지. soot clone은 편도 246KB. 단순 checkpoint 복사 개선의 CPU 이득은 이 Mac에서 작음. | 1–3일 | 소유권 detach·stale 버퍼·롤백·giant 체크포인트 호환 | 현재 Worker 실패·재개 테스트, 4행성 및 모드 전환 GC 후 힙, typed buffer 생존·정확한 완료 상태 게시 |
| **P2** | geometry·appearance·water·biosphere·section dirty 원인을 나눠 바뀐 버퍼만 업로드하고 해안 버퍼를 재사용한다. | 계산상 약 2.52MB/refresh의 일부와 해안 재구축을 줄일 수 있음. 렌더 P95 효과는 브라우저 측정 필요. | 2–4일 | picking·단면·경계·바운딩·물 반경 stale | surface/pour/section lab, 온도만 변화 vs 실제 지형 변화, 모바일 좌표·그림 비교와 프레임 추적 |
| **P2** | observerUpdate와 캠페인 표시의 revision을 구분해 값이 바뀐 DOM만 갱신한다. 관측 집계·radiative target을 공유한다. | 5Hz 전체 배열·진단 작업을 줄일 여지. 실제 이득은 미측정. | 1–2일 | 선택 지점·시간·언어 전환에 오래된 표시 | 캠페인·관측·i18n 테스트, 열어 둔 대시보드와 패널 상태에서 UI 시간 측정 |
| **P3** | 위 개선 뒤에도 처리량이 부족하면 대기 kernel의 WASM/SIMD 또는 GPU 상주화를 별도 설계한다. | CPU 대기가 대부분인 구조의 더 큰 처리량 개선 가능. 이번 조사로 배수 보장 불가. | 1–3주 이상 | 정밀도·보존·CFL·재개·GPU/CPU 일관성과 유지보수 비용 | 같은 법칙의 독립 백엔드 검증·시간/해상도 수렴·실기 비교. readback을 더 늘리는 분할은 별도 평가 |

계산을 빠르게 보이게 하려고 물리 시간을 버리거나, 숨긴 행성만 다른 법칙으로 계산하거나, CFL·보존 검사를 없애는 것은 저장소 설계 기준에 맞지 않는다. 해상도 축소는 실제로 162→642→2,562셀의 비용 차이가 크지만, 물리 통계와 공간 해상도가 달라지므로 사용자 품질 선택 및 수렴 검증이 필요한 별도 제품 결정이다.

## 7. 다음 검증 계획

Mac 잠금 해제 후에는 이미 있는 다음 페이지를 같은 창 크기·devicePixelRatio·브라우저에서 실행한다. 이번 조사에서 실측하지 않은 값은 여기서 확정한다.

| 재현 페이지/조건 | 수집할 지표와 성공 판정 |
| --- | --- |
| `tests/atmosphere-performance-lab.html?kind=dry`, `?kind=wet`, `?kind=wet&gpu=1` | 메인 CPU / CPU Worker / GPU Worker의 단계 처리량·UI 프레임을 분리. 기존 exact 비교와 soot/giant 범위 추가 검토 |
| `tests/surface-performance-lab.html` | 붓기 꺼짐/켜짐 각각 90프레임, refresh·render·frame P95. 지형/물/색 버퍼 바이트 계측 |
| `tests/pour-performance-lab.html`, `?section=1` | 현 기본 공급과 큰 브러시, pick/physics/supply/animate/render 시간·질량 오차 |
| `tests/animal-performance-lab.html`, `?cpu=1` | 이동/정지 draw call·행렬 갱신·프레임 비용. 로우폴리 에셋 수신 작업과 독립적으로 현재 구현만 측정 |
| 실제 앱의 격리된 게스트 테스트 origin | 행성 1/4개·두 모드·paused/1×/4×·캠페인/샌드박스·대시보드 ON/OFF·5초 저장 주기의 Long Task |
| 별도 테스트 DB/합성 저장 | IDB 완료 시간·계정 전환·장시간 이력·이전 형식 재개. 외부 쓰기는 별도 승인된 시험 환경에서 수행 |

성능 목표는 동일 조건에서 물리 처리량과 UI 프레임을 따로 기록하는 것이다. 1×를 CPU만으로 유지하려면 한 행성 물리 단계의 평균·상위 지연이 33.33ms 안에 들어야 하며, 60fps UI 목표는 프레임 예산 16.67ms다. 현재 8샘플의 실험을 장기 브라우저 보장으로 확대하지 않는다. 변경마다 소규모 결정적 회귀와 보존 검사를 먼저 통과하고, 의미 있는 개선을 보일 때 1/4행성·장시간·fallback으로 넓힌다.

## 8. 실행한 검증과 차단 사항

- `node scripts/check-version.mjs`: 통과, `0.7.0-alpha.12` 확인.
- `node node_modules/typescript/bin/tsc --noEmit`: 통과.
- Vite production bundle: 같은 ES2022 타깃·app/clouds 입력으로 `/tmp`에 생성, 성공. 환경 파일·기존 `dist`는 사용·변경하지 않았다. 기존 대형 청크 경고는 남는다.
- 전체 Vitest: 프로젝트 기본과 같은 2 worker·20초 기본 timeout, cache 끔·config runner·JSON 출력 `/tmp`. **534 통과, 2 출력 경로 권한 실패, 19 조건부 건너뜀**, 총 555. 실행 경과 약 210.64초.
- 실패 2건은 `climate-reference.test.ts`의 `artifacts/climate-reference/radiation-observations.json` 및 `column-observations.json` 쓰기에서 EPERM이 발생한 것이다. 수치 assertion 실패로 기록된 것은 없다. 기존 감사 파일을 덮어쓰지 않기 위해 재실행에서는 Node 프로세스 안의 해당 출력 경로만 `/tmp`로 돌리는 preload를 사용했다. **재실행 결과: 동일 소스 2개 모두 통과(약 136.73초). 첫 실행의 534개와 합쳐 실행 대상 536개가 통과했고, 19개 조건부 검사는 미실행이다. 전체 suite를 다시 전부 실행한 결과와는 구분한다.**
- 조건부 계정 실서비스·에뮬레이터·장기 기후·선택적 성능 검사는 건너뛰었다. 기존 Worker 단위 검사는 mock Worker를 이용하므로 실제 브라우저 Worker/GPU 검증을 대신하지 않는다.
- `git diff --check`: 기존 작업 트리 포함 통과.
- 브라우저 FPS·GPU 시간은 Mac 잠금 때문에, 실제 IDB·외부 네트워크는 브라우저·계정 실측을 수행하지 않아 미측정. 로컬 전용 임시 서버를 시도했지만 UI 사용은 불가했고 종료한다. 설치·계정 변경·유료 외부 작업은 없다.
- 종료 시 기준 파일 해시·HEAD·기존 Git 상태 비교: **371개 기준 파일 모두 동일, HEAD 동일, 보고서 추가 전 Git 상태 동일 확인. 보고서·조사 증거 추가 뒤에도 같은 보호 대상과 기존 상태를 다시 확인한다**.

## 9. 증거와 재현 방법

조사 증거는 이 보고서 옆 `performance/2026-10-15/`에 둔다.

- [measurements.json](performance/2026-10-15/measurements.json): 환경·CPU/복사/저장·한도 재현·메모리·번들·테스트 요약.
- [wet.cpuprofile](performance/2026-10-15/wet.cpuprofile): Node Inspector 샘플 프로파일. DevTools Performance에서 열 수 있다. Vite 변환 프레임의 줄 번호는 원본 줄 번호와 다를 수 있다.
- [bundle-modules.json](performance/2026-10-15/bundle-modules.json): 청크 그래프·모듈 구성·압축 크기.
- [source-baseline.json](performance/2026-10-15/source-baseline.json): 조사 전 371개 파일 해시와 기존 Git 상태.
- `cpu-harness.mjs`, `memory-harness.mjs`, `save-limit-proof.mjs`, `build-harness.mjs`: 임시 진단 스크립트. 프로젝트 파일을 수정하지 않고 현재 소스를 로드하며 `/tmp`에만 실행 산출물을 쓴다. 이 Mac의 정본 경로가 명시되어 있다.
- `redirect-test-artifacts.cjs`: 두 기존 감사 테스트의 파일 출력만 `/tmp`로 재지정한다. 소스와 수치 assertion은 변경하지 않는다.

정본 경로에서 기존 Node·node_modules만 이용하는 재현 예시:

```sh
node --expose-gc docs/performance/2026-10-15/cpu-harness.mjs
node docs/performance/2026-10-15/memory-harness.mjs
node docs/performance/2026-10-15/save-limit-proof.mjs
node docs/performance/2026-10-15/build-harness.mjs
```

출력 파일명은 하네스에 지정된 `/tmp/sandsphere-performance-*20261015*`다. 같은 소스 기준인지 먼저 baseline 해시와 비교하고, 다른 부하가 큰 테스트와 벤치마크를 겹치지 않게 실행한다. 합성 저장의 실제 `encodeSave()` 호출은 압축 크기만 검사하고 Firebase 서비스를 초기화하거나 업로드하지 않는다.
