# Sandsphere 전체 성능 최적화 연구

2026-10-23 · `0.7.0-alpha.18` 작업 트리 · 연구 및 재현용 계측 · 제품 코드 변경 없음

## 결론

우선순위는 **저장 실패·저장 중 화면 정지 → 분광 복사 계산 → 불필요한 GPU 왕복 → 배경 행성·표면 갱신 → 초기 로딩**이다. 현재는 렌더링과 시뮬레이션 처리량을 별도로 개선해야 한다.

- 실제 브라우저의 젖은 해안에서 CPU Worker는 화면 프레임 평균을 **1,108.6ms → 16.72ms**로 유지했지만, 물리 한 단계는 여전히 **1,095.5ms**였다. Worker가 이미 제공하는 응답성 개선을 새 최적화 성과로 계산하면 안 된다.
- Node의 같은 해상도 젖은 해안에서는 평균 **1,074.8ms/단계**, 별도 계측 구간에서 복사 계산이 **658.1ms/단계**였다. 새로운 기체 조성 검사가 정확도를 높였으므로 과거 속도를 되찾기 위해 무효화 기준을 되돌리지 않는다.
- 진행된 목성 8개 합성 저장본은 현재 `encodeSave()`에서도 **20MiB 압축 한도 때문에 거부**됐다. 젖은 해안 8개의 다른 합성 표본은 원문 **64.97MiB**, 압축 **20.69MiB**로 두 한도를 넘었다. 사용자 저장본이나 클라우드 업로드 시험은 아니다.
- 실제 IndexedDB에 8행성 표본을 넣을 때 **동기 제출만 평균 236.5ms**였다. 저장 API가 Promise를 반환해도 메인 스레드 비용이 사라지는 것은 아니다.
- 현재 GPU 솔버는 GPU 결과를 읽어 온 뒤 사용하지 않고 Float64 호스트 상태에서 공통 물리를 실행한다. 브라우저 비교도 GPU Worker의 처리량 이점을 보여 주지 않았다. 큰 성능 향상은 대기 계산 자체를 줄여야 얻을 수 있다.

## 범위와 재현 조건

정본: `/Users/garden/Workspace/Projects/sandsphere`. HEAD는 `02d53d7bb7111ed2a858599dd296489db9246417`, 브랜치는 `codex/animal-ai`다. HEAD 이후 물리·저장·렌더러·검사에 광범위한 미커밋 변경이 있으므로 HEAD만으로 측정 대상을 설명할 수 없다. 조사 시작의 **517개 기존 파일 해시**를 [source-baseline.json](performance/2026-10-23/source-baseline.json)에 보존했다.

환경은 Mac16,9, arm64, 64GiB RAM, 물리 코어 16개, macOS 27.0.1, Node v24.20.0이다. 브라우저는 Codex 인앱 브라우저 Chromium 155다. 물리 백엔드 비교와 IDB 시험은 1280×720, DPR 2이며 실제 렌더 버퍼는 생산 코드의 픽셀 제한에 따라 1885×1060이었다. 최종 실제 게임·독립 표면 시험은 viewport 고정 기능을 적용한 1280×720, DPR 1, 렌더 버퍼 1280×720이다. 두 조건의 절대 프레임 시간을 직접 비교하지 않는다. 렌더러는 모두 **WebGL**, 물리 백엔드는 main CPU / CPU Worker / WebGPU Worker다. WebGPU 렌더러의 성능, GPU timestamp, 실물 휴대폰은 측정하지 않았다.

자체 벤치마크·빌드·테스트를 서로 겹치지 않게 실행했다. 다만 사용자 머신의 다른 빌드·그래픽 앱은 실행 중이었다. 시스템 전체를 독점한 실험이나 장시간 열 안정화 결과는 아니다. 짧은 표본의 차이 몇 %를 확정적인 개선율로 해석하지 않는다.

현재 공통 시간 간격은 `PHYSICS_DT=1/30` 게임초, 대기 시간 배율은 60이다. 목표 1×를 유지하려면 단계 예산은 **33.33ms**, 4×는 **8.33ms**다. UI 60fps의 예산 **16.67ms**와 별개다. 아래 처리율은 계산 시간만으로 산출한 상한이며, 실제 앱에는 관측·저장·배경 행성·렌더 비용이 더해진다.

## 1. 물리 처리량과 병목

[cpu-measurements.json](performance/2026-10-23/cpu-measurements.json)은 생산 모듈을 Vite SSR로 읽어 `CpuSolver.advance()`를 실행한 결과다. 첫 단계 1회와 추가 5회 준비 후 24단계를 측정했다. 즉 측정 구간은 초기화 후 7–30번째 단계이며, 장기 평형 상태가 아니다. 별도 함수 계측 3단계와 wet 샘플 프로파일 16단계는 뒤이어 진행한 다른 시간 구간이다.

| 시나리오 | 셀 | 단계 평균 ms | 표본 P95 ms | 1× 대비 계산 상한 |
| --- | ---: | ---: | ---: | ---: |
| 건조 모래·질소 | 162 | 20.30 | 22.11 | 1.642× |
| 건조 모래·질소 | 642 | 85.90 | 104.76 | 0.388× |
| 건조 모래·질소 | 2,562 | 326.56 | 433.49 | 0.102× |
| 젖은 해안 | 2,562 | 1,074.80 | 1,133.62 | 0.031× |
| 메탄·중력 0.3 | 2,562 | 343.59 | 368.18 | 0.097× |
| 목성 | 2,562 | 253.82 | 275.97 | 0.131× |
| 건조 모래·기후 끔, 비용 분리용 | 2,562 | 88.72 | 98.14 | 0.376× |

해상도 축소와 기후 끄기는 비용 분리용 대조군이다. 공간 해상도나 물리를 바꾸므로 그대로 성능 패치로 채택하는 제안은 아니다. 10월 15일 alpha.12 보고서와는 소스·Node·준비 단계·표본 구간이 달라 통제된 전후 비교가 아니다.

### 젖은 해안: 복사 재구성 비용이 가장 크다

함수 계측 구간 전체는 평균 **1,112.38ms/단계**였다. 그 안에서 `climate.step` 1,029.69ms, `air.advance` 877.31ms, `air.radiation` 658.05ms, `air.dynamics` 77.64ms, `combustionStep` 25.19ms를 썼다. **부모·자식 시간은 중첩하므로 합산하지 않는다.** 복사 시간은 이 계측 전체의 약 59%다.

[wet.cpuprofile](performance/2026-10-23/wet.cpuprofile)의 14,234개 self sample 중 `radiationColumn` 내부 배열 구성 콜백을 중심으로 한 익명 `layeredAtmosphere` 프레임 약 23%, `radiationColumn` 자체 9.37%, `spectralGasOptics` 8.74%, `singleRadiativeFluxes` 5.13%, `waterCoefficient` 4.80%였다. GC self sample은 약 0.63%다. 따라서 핵심은 **배열 구성·채우기와 분광 연산 비용**이며, GC만의 문제라고 설명할 근거는 없다. 프로파일 줄 번호는 Vite 변환본 기준이다.

현재 `layeredAtmosphere.ts:612–615`는 6개 기체 각각의 재고 차이가 두 재고 중 큰 값의 1%를 초과하거나 첫 흡수 기체가 유입되면 복사를 다시 계산한다. 젖은 초기 지표는 대기 수증기가 없는 상태에서 증발·수송을 시작하므로 이 조건을 자주 충족할 수 있다. dry와 wet은 계측 구간의 `radiation()` 호출 수가 같지만 경과 시간은 22.82ms 대 658.05ms다. **수증기가 정확히 몇 번 무효화를 일으켰는지는 미계측**이며, 위 설명은 코드와 초기 상태에 근거한 원인 가설이다.

이 기준은 alpha.18 정확도 보완의 일부이고 `atmosphere-exchange18.test.ts`가 첫 흡수 기체 유입과 조성 치환을 보호한다. 개선 순서는 다음이 적합하다.

1. `radiationColumn()`의 solver 내부 경로에 고정 모양 scratch를 재사용한다. 현재 열당 LW/SW band 객체 64개와 길이 11 typed array 256개를 만들고, source·gas optics 결과까지 포함하면 300개 이상을 만든다. 이는 소스 구조로 센 수이며 allocation profiler 실측은 아니다.
2. `spectralSource`·`spectralGasOptics`의 내부 destination-buffer 경로를 두고 scalar loop로 채운다. 공개 진단 함수의 결과 객체는 독립성을 유지한다. band 합산 순서·구름 중첩·차가운 복사원 근사도 보존한다.
3. 이미 구한 `pressure[k]`를 cloud-fraction 계산에 전달한다. 이후 pressure/interface의 공통 순회를 검토하되 부동소수점 합산 순서 변경을 별도로 검사한다.
4. cache age·기체별 재고·온도·cloud·dust·soot별 무효화 카운터를 추가해 초기 wet과 충분히 진행한 wet을 별도 측정한다.

예를 들어 복사 비용을 절반으로 줄인다면, 이 계측 구간에서 전체 단계는 산술적으로 약 30% 줄어든다. **아직 구현하거나 달성한 수치가 아니다.** 복사만 최적화해 1× 예산을 바로 만족할 수 있는 상태는 아니다.

### 건조·메탄·목성: 수송과 열역학 집계

건조 대기의 dynamics는 77.84ms/단계, 메탄은 113.35ms/단계였다. 목성의 별도 계측 전체는 266.49ms이며 dynamics 145.98ms, radiation 27.45ms, cloud equilibrium 34.00ms였다.

`layeredAtmosphere.ts:348`의 edge queue는 donor의 energy/capacity/species를 반복 합산한다. `clearFlux()` 이후 `commit()` 전까지 변하지 않는 mass/capacity/enthalpy만 stage-local scratch에 저장하는 방식이 적합하다. 반응·상변화·commit 이후에는 무효화한다. `deepAtmosphere.ts:99–101`의 edge flow 객체, 벡터 배열, 같은 셀의 Coriolis·drag·gasR 재계산도 후보다. 같은 단계 안의 중복 제거와 더 적은 물리 단계를 실행하는 변경을 구분해야 한다.

## 2. Worker와 GPU: 실제 브라우저 비교

[browser-physics-wet.json](performance/2026-10-23/browser-physics-wet.json). 생산 `PlanetView`, `CpuSolver`, `WorkerSolver`를 사용하고 각 백엔드를 같은 초기 상태에서 6회 준비 + 24단계 실행했다. 대기·구름 표시를 켰으며 동일한 WebGL 화면에서 비교했다. 이 하네스는 `PlanetView` 생성자 기본 smooth 표면이며, 실제 게임의 `setSurfaceStyle(true,1,true)`를 적용하지 않았다. 따라서 백엔드 간 비교로 사용하고 실제 게임의 절대 FPS로 일반화하지 않는다. 원본 JSON의 `quality: production defaults`는 이 조건을 부정확하게 표현한 메타데이터이므로 이 설명으로 정정한다.

| 물리 백엔드 | 단계 평균 ms | 화면 프레임 평균 ms | 화면 P95 ms | 50ms 초과 프레임 |
| --- | ---: | ---: | ---: | ---: |
| 메인 CPU | 1,132.64 | 1,108.60 | 1,184.10 | 24 / 25 |
| CPU Worker | 1,095.50 | 16.72 | 19.10 | 1 / 1,612 |
| WebGPU Worker | 1,123.53 | 17.84 | 26.70 | 15 / 1,553 |

30단계 종료 상태의 surface·전체 climate checkpoint·lift·에너지 및 물질 교환 배열은 **세 경로에서 모두 `Object.is` 기준 일치**했다. 한 초기 상태의 짧은 동등성 검사이며 모든 물리 조건이나 장시간의 보증은 아니다. 백엔드를 고정 순서로 한 번씩 실행했으므로 CPU Worker와 GPU Worker 간 약 2.6% 시간 차이는 유의한 우열로 단정하지 않는다.

`gpu.ts:101–126`은 upload → compute 3개 → 전체 readback → `mapAsync()`를 실행하지만, line 117의 `data`를 실제 상태 계산에 사용하지 않는다. line 121에서 원래 `surface`를 Float64로 복사한 후 호스트 공통 수송·반응·대기를 실행한다. 깊은 대기도 CPU 경로다. 먼저 이 **사용하지 않는 dispatch/readback**을 제거하거나 정확한 CPU 백엔드로 라우팅하는 작은 변경을 검증할 가치가 있다. GPU 출력의 Float32 값을 다시 정본에 적용하는 것은 저비트 재고·열 잔차 계약 때문에 별도 설계다.

`mapAsync`는 버퍼 내용을 읽을 준비가 될 때 resolve되고, 매핑 중 GPU 사용을 제한한다. 현재 구조의 동기화 비용을 검토하는 근거이며, 이 API 설명만으로 실제 GPU 소요 시간을 추정하지 않는다. [MDN mapAsync](https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer/mapAsync)

### 실제 게임 화면에서 확인한 범위

별도 localhost test origin의 게스트 샌드박스에서 UI로 만든 기본 암석 행성 1개를 검사했다. 실제 앱의 hex 표면·관측 패널·자동 저장을 포함하고, WebGL + CPU Worker를 사용했다. 측정용 부모 페이지는 같은 origin의 실제 앱 iframe을 띄우고 시작·종료 stats와 15초 동안의 rAF 간격, iframe Long Tasks를 읽었다. 엔진의 GPU 프레임 시간이나 input latency 측정은 아니다. 원본: [일시정지](performance/2026-10-23/browser-game-paused-1792759116435.json), [재생](performance/2026-10-23/browser-game-running-1792759145821.json).

| 실제 앱 상태 | 프레임 표본 | 평균 ms | P95 ms | 50ms 초과 | 메인 Long Tasks |
| --- | ---: | ---: | ---: | ---: | --- |
| 일시정지 | 800 | 18.75 | 33.30 | 3 | 0 |
| 목표 1× 재생 | 773 | 19.42 | 33.40 | 5 | 217 / 219 / 206ms |

두 측정 모두 시작·종료 viewport는 1280×720이고 resize 이벤트는 없었다. 재생 구간은 게임 시간 6.500→8.767초, 실제 경과 15.014초로 **목표 1×의 약 15.1%**였다. 대기 배율을 반영하면 실제 1초당 약 9.06행성초이며, 목표는 60행성초다. 종료 직전 UI도 약 8.9초/초를 표시했다. 일시정지 구간은 게임 시간이 변하지 않았다. 이 결과는 wet 합성 시나리오와 다른 지형·진행 상태다.

재생 중 긴 작업의 시작 간격은 약 4.83초·5.13초였다. 5초 자동 저장 경로와 일치하는 패턴이지만, 이 관찰은 작업별 stack attribution을 포함하지 않아 자동 저장이 원인이라고 확정하지 않는다. 이전 가변 viewport 탐색 결과는 보존하되 이 표에서 제외했다. [실제 게임 화면](performance/2026-10-23/actual-game-measurement.jpg)

## 3. 저장: 용량과 메인 스레드 비용을 함께 해결

### 클라우드 한도 재현

[save-limit-proof.json](performance/2026-10-23/save-limit-proof.json)은 목성 프리셋을 14단계 진행하고 모드당 4개씩 복제한 유효한 합성 system이다. `validSystem=true`, 원문 55,087,126B이며 실제 `encodeSave()`가 “압축한 저장 데이터가 최대 크기(20MB)를 넘었습니다.”를 반환했다. 인코딩만 호출했고 계정 초기화·네트워크 업로드는 하지 않았다.

아래는 별도 CPU 연구의 더 진행한 표본이다. wet은 49단계, 목성은 33단계를 거친 상태다. 각각 같은 상태를 1/4/8개로 복제했고 telemetry는 제외했다. prepare/clone/stringify/gzip은 3회 평균이다.

| 상태 | 행성 | JSON MiB | gzip MiB | prepare ms | clone ms | stringify ms | gzip 경과 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| wet | 1 | 8.12 | 2.59 | 34.1 | 58.6 | 27.6 | 170.5 |
| wet | 4 | 32.48 | 10.35 | 122.4 | 248.5 | 122.9 | 692.5 |
| wet | 8 | 64.97 | 20.69 | 235.6 | 509.8 | 225.7 | 1,269.6 |
| 목성 | 1 | 6.55 | 2.52 | 83.7 | 27.6 | 23.4 | 135.4 |
| 목성 | 4 | 26.22 | 10.07 | 323.6 | 124.2 | 96.6 | 534.8 |
| 목성 | 8 | 52.44 | 20.14 | 657.6 | 232.8 | 195.7 | 1,059.1 |

wet 8행성 표본은 크기와 `firebase.ts:24–29`의 검사에 비추어 원문 64MiB 제한에서 먼저 거부될 것으로 판단된다. 이 표본의 `encodeSave` 자체를 별도로 호출한 것은 아니다. gzip 시간은 비동기 스트림 경과 시간이며 전부 화면 정지라고 해석하지 않는다.

### 실제 IndexedDB 측정

[browser-save-wet.json](performance/2026-10-23/browser-save-wet.json)은 3단계 진행한 별도 wet 상태와 전용 무작위 IDB 슬롯을 사용했다. DB를 연 뒤 생산 `saveSnapshot()`을 호출했다. 자신이 만든 슬롯만 시험 후 제거했다. 단일 `snapshotSurface()`는 평균 **86.13ms**였다.

| 행성 | prepare 평균 ms | IDB 동기 제출 평균 ms | IDB 쓰기 완료 평균 ms | IDB 읽기 완료 평균 ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 20.53 | 29.20 | 40.73 | 34.33 |
| 4 | 62.47 | 118.47 | 143.77 | 133.07 |
| 8 | 109.93 | 236.50 | 286.67 | 287.30 |

쓰기를 마치는 경과 시간에는 동기 제출이 포함되므로 두 값을 더하지 않는다. Node의 `structuredClone()` 시간을 IDB 시간으로 대신하지 않았다. 이 연구 하네스는 왕복 `savedAt`만 확인했으며, byte-exact 저장 정확성 검사는 기존 저장 회귀와 구분한다.

현재 `main.ts:415–425`의 `capture()`와 `captureSystem()`은 같은 `snapshotSurface()`를 두 번 호출한다. `session.ts:12–17`은 호출마다 shadow `WeatherClimate`를 만들고 복원한다. 여기에 전체 모드의 clone·prepare·telemetry archive가 붙는다. 5초 자동 저장(`main.ts:450–461,1037`)은 변경 없는 일시정지 상태도 전체 capture를 수행한다. IDB·종료 Service Worker는 저장 수명과 localStorage 용량 문제를 개선했지만 캡처 비용을 없애지는 않았다.

권장 순서는 **한 번의 캡처에서 state·collected를 함께 반환 → 모든 저장 대상 변경을 포함하는 revision으로 무변경 저장 생략 → Worker 소유 상태에서 준비·직렬화 → 정확한 재개 상태를 보존하는 무손실 형식/증분 저장**이다. 오래된 캐시도 재개 결과에 영향을 줄 수 있으므로 “계산 캐시이니 버린다”는 방식은 피한다. 클라우드 한도 확대는 규칙·전송·비용·옛 저장 호환성을 함께 검토해야 한다.

이번에 통과한 `giant-save-size.test.ts`는 초기 목성·토성 조합을 검사한다. 위의 진행된 8개 목성 회귀까지 보호한다는 뜻은 아니다. 새 최적화의 첫 검증에는 실제로 진행한 상태와 telemetry를 함께 넣어야 한다.

## 4. 메모리·배경 행성·렌더링·입력

### 버퍼와 일반 배열

[memory.json](performance/2026-10-23/memory.json)에서 일반 대기 checkpoint는 **7,573,320B**, CPU solver에서 도달 가능한 고유 typed buffer는 약 **24.16MiB**다. 객체·일반 숫자 배열·GPU 메모리를 포함한 전체 사용량이나 누수 측정은 아니다. 일반/깊은 대기를 동시에 생성하는 `WeatherClimate` 구조에서 깊은 대기 하위 그래프는 약 7.28MiB이므로 필요한 도메인만 할당하는 후보도 있다.

현재 transfer list에는 `gasRadiationCache`, `boundaryImpulse`, `sootRadiationCache`, `sootLiftCarry`가 빠져 있다. 이들은 메시지에 포함되므로 데이터 누락이 아니라 structured clone 비용이며, 합계 **편도 1,598,712B**다. 이미 복사한 checkpoint 버퍼를 transfer list에 포함하는 것이 작은 개선 후보다. 살아 있는 상태를 직접 transfer하면 detach되어 표시·저장·실패 롤백이 깨질 수 있다. [MDN transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)

wet의 typed checkpoint 복사는 평균 0.64ms인 반면 일반 배열 `climate.snapshot()`은 **18.32ms**였다. `system.ts:90–111`은 배경 행성을 직렬 await하고 매 단계 전체 state·climate를 일반 배열로 게시한다. 3개 배경의 동일 snapshot 호출 비용만 더하면 약 55ms이지만 이는 **호출 비용 합산 추정**, 실제 4행성 앱 프레임 실측은 아니다. 먼저 committed typed 읽기 모델과 저장 직렬화를 분리하고, 이후 독립 행성 Worker의 제한된 병렬 실행을 검토한다.

### 표면 갱신

표면 스트레스 시험은 생산 `PlanetView.update()`를 프레임마다 호출한다. 실제 앱의 15Hz coalescing보다 높은 빈도이며 물리 실행을 대신하지 않는다. 해안·식생·구름이 있는 상태에서 온도만 바뀌어도 전체 geometry/water/heat 업로드와 해안 재구축이 남는다(`planet.ts:450–601`).

[browser-surface-wet.json](performance/2026-10-23/browser-surface-wet.json)은 새 페이지·새 뷰에서 물리 비교를 실행하지 않고 측정했다. hex 표면·stratus·해안·토양·식생을 구성하고 각 모드 30프레임 준비 후 150프레임을 측정했다. viewport와 렌더 버퍼는 1280×720, DPR 1이다.

| 표면 작업 | update 평균 ms | update P95 ms | render CPU 제출 평균 ms | 프레임 간격 평균 ms |
| --- | ---: | ---: | ---: | ---: |
| 정지 화면 | — | — | 0.47 | 21.00 |
| 온도만 변경 | 20.72 | 27.30 | 0.45 | 21.77 |
| 모래 붓기 + 온도 변경 | 21.62 | 28.40 | 0.45 | 22.88 |

물리 비교 뒤 동일 뷰에서 실행한 초기 탐색 표본은 이전 climate 참조가 남았으므로 [별도 파일](performance/2026-10-23/browser-surface-wet-after-physics-exploratory.json)에 보존하고 최종 표에서 제외했다. 두 표본은 DPR도 달라 개선율 비교에 사용할 수 없다. 하네스 설정 파일 추가로 중간 시험이 자동 새로고침된 경우는 결과에서 제외하고, 새 페이지에서 완주한 위 결과만 사용했다.

geometry / water / appearance / temperature / biosphere / section의 변경 원인을 분리하고, 실제 바뀐 버퍼만 갱신하는 것이 적합하다. `sectionDirty`의 무조건 설정과 단면 전체 메시 재생성, 선택 arc의 고정 점 재탐색도 함께 확인한다. picking·바운딩·해안·단면 선택을 유지해야 한다.

동물 thin instance, 15Hz 표면 합치기, 높이 불변 시 법선 생략, 닫힌 대시보드 렌더 생략, 화면 픽셀 제한은 이미 구현돼 있다. 이를 새 개선안으로 반복하지 않는다. hover picking은 앱에서 33ms로 제한하지만 Babylon 기본 pointer-move picking 경로도 남아 있다. 실제 중복 호출 비용은 아직 측정하지 않았고, 공식 문서도 이를 끌 경우 pointer 이벤트 의미가 바뀜을 명시한다. [Babylon scene optimization](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene/)

관측·telemetry는 완료 revision별 totals·mass·enthalpy·온도 집계를 공유하고, 바뀐 DOM만 갱신할 여지가 있다. 다만 현재 계측으로 UI 항목별 비용 순위까지 확정하지 않았다. 기록 주기는 창을 닫았다고 임의로 중단하지 않는다.

## 5. 초기 로딩과 번들

생산 설정과 같은 ES2022·app/clouds 두 입력으로 환경 파일을 읽지 않고 `/tmp`에 빌드했다. TypeScript 검사도 별도로 통과했다. 기존 `dist`는 덮어쓰지 않았다. [bundle-modules.json](performance/2026-10-23/bundle-modules.json)

| 산출물 | 원본 B | gzip B | Brotli B |
| --- | ---: | ---: | ---: |
| 앱 정적 JS 그래프, 21청크 | 5,229,657 | 2,212,032 | 1,937,660 |
| solver Worker, 별도 로딩 | 2,371,827 | 1,432,943 | 1,316,237 |
| 공용 planet JS | 4,208,482 | 1,902,276 | 1,677,652 |
| app JS | 839,912 | 257,065 | 214,557 |

공용 planet과 app은 정적 그래프에 이미 포함된다. Worker만 별도다. 위 압축 크기는 로컬 압축 실험이고 네트워크 실제 전송량이나 cold load 시간은 아니다.

과학 테이블 `ecckd-32.json`과 Firebase는 여전히 초기 정적 의존 그래프에 있다. `spectralRadiation.ts:8–11`은 모듈 평가 때 데이터를 Float64로 디코드한다. main과 각 Worker가 각각 읽는 구조를 줄이려면 상수·타입·관측 읽기 모델과 solver 구현의 import 경계부터 분리해야 한다. 단순 청크 분리는 다운로드 총량 감소를 보장하지 않는다. 현재 Vite 8은 Rolldown `output.codeSplitting`을 사용한다. [Vite production build](https://vite.dev/guide/build)

`boot()`는 auth → checkpoint Service Worker → 로컬 저장 읽기, 로그인 상태에서는 클라우드 읽기까지 기다린 뒤 `PlanetView`를 만든다. Service Worker 활성화/응답 timeout은 각각 최대 10/30초다. 정상 경로에서 이 시간이 발생했다는 뜻은 아니다. 독립 준비를 병렬화하고 초기 시각 준비를 분리하되, 계정 범위·클라우드 충돌·복구 결정을 건너뛰어서는 안 된다.

## 6. 실행 순서와 완료 기준

| 순서 | 구체적 작업 | 성공 판정과 회귀 범위 |
| --- | --- | --- |
| **P0** | 진행된 8행성+두 모드+telemetry 저장 한도 회귀를 추가하고 무손실 표현/증분 정책 설계 | raw/gzip 한도 내 저장·정확한 재개·옛 형식 읽기·중단 복구. 한도만 늘리거나 기록을 삭제해서 통과시키지 않음 |
| **P1-A** | 중복 snapshotSurface 1회화, 무변경 자동 저장 생략, Worker 저장 준비 | 실제 앱 paused/running 활성 모드 1/4행성, 두 모드 포함 저장 8행성에서 캡처·IDB 동기 시간과 50ms 초과 프레임 감소. in-flight·낙하·계정 충돌·종료 저장 보존 |
| **P1-B** | radiation scratch·into API·중복 pressure 제거 | 동일 초기/장기 wet 및 dry/methane에서 단계 평균/P95 개선. 분광 기준·구름 중첩·첫 기체 유입·1% 무효화·CPU/Worker/재개 동등성 |
| **P1-C** | 사용하지 않는 GPU 패스 제거/CPU 라우팅; transfer list 완비 | 장치 손실·fallback·명령 한 번 실행·저비트 재고 보존. 실제 CPU/GPU Worker 비교와 전체 버퍼 detach 검증 |
| **P2** | stage-local 열역학 캐시, 깊은 대기 할당 축소 | 질량·원소·열·운동량 및 numerical ledger, 평형·극저온·대시간/소시간 비교. giant plume·침강·재개 |
| **P2** | 배경 typed state 상주, 관측 집계 재사용, 제한된 병렬 실행 | 활성/배경 같은 시간 결과, 행성 전환·실패·저장 원자성. 1→4행성의 총 처리량과 메인 P95·메모리 |
| **P2** | 표면/단면 dirty 구분, shoreline 버퍼 재사용 | 온도만 변경 시 불필요 업로드 제거, 실제 편집·물·단면·picking 보존. 고정 카메라 품질과 프레임을 함께 비교 |
| **P2** | 초기 import 경계와 boot 대기 분리 | cold/warm cache·게스트/로그인·오프라인/SW 불가에서 첫 화면/조작 가능/계산 시작을 따로 측정 |
| **P3** | 위 개선 이후 WASM SIMD 또는 대기 계산의 GPU 상주 구조 실험 | Float64/저비트 잔차·보존·CFL·재개 계약부터 명시. 백엔드 전환의 배수 향상은 현재 증거로 보장할 수 없음 |

첫 패치의 성공 조건은 물리·저장 결과를 보존하면서 측정한 반복 비용을 줄이는 것이다. UI 60fps와 1× 시뮬레이션은 최종 목표로 계속 추적하되, 임의 해상도 축소·숨긴 행성의 다른 법칙·물리 시간 버리기·정밀도/보존 검사의 제거를 성능 개선으로 취급하지 않는다.

## 7. 검증 상태와 남은 범위

- `check:version`: 통과, `0.7.0-alpha.18`.
- 프로젝트 TypeScript `--noEmit`: 통과.
- 연구 브라우저 하네스와 생산 src를 포함한 별도 TypeScript 검사: 통과.
- 생산 설정 동등 Vite build: 통과, 기존 대형 청크 경고 유지. 측정 결과를 위한 gzip/Brotli 분석 포함 경과 약 9.65초이며 Vite 자체 빌드는 약 0.53초였다.
- 집중 baseline 검사: `worker-solver`, `atmosphere-exchange18`, `giant-save-size`, `surface-buffers`, `browser-storage`, **27/27 통과**. 전체 suite는 이번 연구에서 재실행하지 않았다.
- 실제 브라우저: wet의 세 백엔드 결과 일치, 표면·실제 IDB 비용 측정. `drawCalls` 메타데이터는 reset하지 않은 누적 내부 counter이므로 **프레임당 draw call로 사용하지 않는다**. render CPU 제출 시간도 GPU 시간으로 부르지 않는다.
- 미측정: 실물 모바일·배터리·열 안정성·GPU timestamp·장시간 메모리 누수·실제 4행성 처리량·네트워크 RTT/클라우드 쓰기·오프라인 시작 시간·full application CPU 세부 attribution.
- 기존 517개 파일의 SHA-256은 조사 시작과 모두 같고, HEAD도 같다. 제품 코드·버전·CHANGELOG 변경이나 배포는 수행하지 않았다. 연구 산출물만 추가했다. [보존 확인](performance/2026-10-23/preservation.json)

## 증거와 재실행

모든 신규 산출물은 [performance/2026-10-23](performance/2026-10-23/)에 있다. [검증 요약](performance/2026-10-23/verification-summary.json), `source-baseline.json`과 종료 보존 확인으로 기존 변경을 구분한다. 원본 프로파일과 이전 탐색 표본도 보존한다. 측정 탭과 로컬 서버는 종료하고 브라우저 viewport 설정은 복원했다.

```sh
node --expose-gc docs/performance/2026-10-23/cpu-harness.mjs
node docs/performance/2026-10-23/memory-harness.mjs
node docs/performance/2026-10-23/save-limit-proof.mjs
node docs/performance/2026-10-23/build-harness.mjs
node docs/performance/2026-10-23/serve.mjs
```

CPU/build 산출물은 하네스의 `/tmp/sandsphere-performance-*-20261023.*`에 생성한다. 브라우저는 `http://127.0.0.1:5183/docs/performance/2026-10-23/browser-lab.html?kind=wet&cpu=1`에서 버튼으로 실행한다. 실제 게임 검사는 `game-lab.html`의 별도 test 슬롯을 사용한다. JSON 측정 결과를 같은 로컬 연구 서버에만 저장한다. 테스트 서버는 계정 환경 파일을 로드하지 않는다. 배포 entry에는 연구 페이지를 포함하지 않는다.
