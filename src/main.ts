import {onAuthStateChanged} from 'firebase/auth';
import {firebaseServices,FirebaseSaveStore} from './account/firebase';
import {chooseSave,saveScope,SaveConflict,type SyncCheckpoint,type RemoteSave} from './account/sync';
import {AccountPanel,accountMarkup} from './ui/account';
import './ui/account.css';
import {type ClimateLayer} from './sim/weatherClimate';
import {CLOUD_VISIBLE_MASS} from './sim/layeredAtmosphere';
import {thermalTarget} from './sim/climate';
import {boilingPoint,waterActivity,REFERENCE_PRESSURE,saturationPressure} from './sim/waterPhysics';
import {phaseLimitNotes,albedo,transmittedLight} from './sim/materialPhysics';
import {setupHelpTips} from './ui/helpTip';
import {ActivityCenter,appDialogsMarkup} from './ui/appChrome';
import {PlanetNavigation,planetNavigationMarkup} from './ui/planetNavigation';
import {TelemetryStore} from './sim/telemetry';
import {parseTelemetryCsv,prependTelemetryCsv} from './sim/telemetryCsvImport';
import {archiveTelemetry,restoreTelemetry,fullTelemetryArchive,type TelemetryArchive} from './sim/telemetryPersistence';
import {PlanetDashboard,dashboardMarkup} from './ui/planetDashboard';
import {ActualGameRate,formatPlanetDuration,formatPlanetElapsed,formatPlanetRate,realDurationForPlanetPeriod,SIMULATION_SPEEDS,speedLabel,type SimulationSpeed} from './ui/simulationTime';
import {APP_VERSION_LABEL} from './version';
import type {NewNotice} from './ui/activityStore';
import {setupRangeControls,updateRangeControl,RANGE_THUMB_SIZE} from './ui/rangeControl';
import {Inventory,inventoryMarkup} from './ui/inventory';
import {RotationStick,rotationStickMarkup} from './ui/rotationStick';
import {ObservationPoint} from './ui/observationPoint';
import {sceneLayersMarkup,updateClimateLegend,updateSceneLayerLegend,keepSceneLayersVisible,setupClimatePicker,updateClimatePicker} from './ui/sceneLayers';
import {SurfaceRefreshClock} from './render/budget';
import {spinPeriodSelection,updateSyncPeriodMarker,validSpinSpeed} from './ui/spinPeriod';
import {SectionSelectionControls,sectionSelectionMarkup} from './ui/sectionSelection';
import {planetControlsMarkup,sectionControlsMarkup,setPlanetSettings} from './ui/planetControls';
import {inspectorMarkup} from './ui/inspector';
import {expeditionMarkup,updateObservatory,updateExpeditions,setMetric,formatReading,updateWeatherReadout} from './ui/observatory';
import {WeatherReadings} from './ui/weatherReadings';
import {freshProgress,advanceProgress,EXPEDITIONS} from './sim/progress';
import {impactMeteor} from './sim/meteor';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import './style.css';
import './ui/planetDashboard.css';
import './ui/glassWorkbench.css';
import './ui/workbench.css';
import './ui/onboarding.css';
import './ui/mobileWorkbench.css';
import {setupWorkbench} from './ui/workbench';
import {FirstSteps,firstExperimentMarkup,firstStepsMarkup} from './ui/onboarding';
import {PlanetView} from './render/planet';
import {createSphere,cellBrushWeights,cellBrushAngle,nearestCell} from './sim/sphere';
import {F,STRIDE,PRODUCTS,emptyStock,isProduct,COMMAND_STRIDE,SURFACE_ERASE,COMMAND_FIELD,CpuSolver,seedWorld,seedPlanet,spherizeLegacyRockPlanet,environmentFor,totalMass,totalEnthalpy,cellPressure,totals,isGas,gravityMultiplier,
  type Stock,type Product,type Solver,type Material,type Tool,type Snapshot,type Environment,type PlanetMaterial,type GasMaterial} from './sim/model';
import {GASES,atmosphereState,atmosphereReadout} from './sim/atmosphere';
import {atmosphereOptics} from './sim/optics';
import {orbitalSun,orbitalPeriod,localSun,orbitalEnvironment,solarEnergy} from './sim/orbit';
import {GpuSolver} from './sim/gpu';
import {WorkerSolver} from './sim/workerSolver';
import {PHYSICS_DT,SimulationClock} from './sim/clock';
import {heatForTarget} from './sim/toolHeat';
import {saveSnapshot,loadSnapshot,loadRecord,validSnapshot,upgradeSnapshot} from './sim/storage';
import {snapshotSurface} from './sim/session';
import {BackgroundWorlds,PLANET_LIMIT,validSystem,prepareSystemSave,migrateWorld,switchSystemMode,materialSupply,type GameMode,type ModeWorld,type SystemSave,type PlanetRecord} from './sim/system';
import {systemDialog,renderSystemUi,updateSystemUi} from './ui/system';
import {icon} from './ui/icons';
import {MATERIALS,RESEARCH,PRODUCT_NAMES} from './ui/content';
import {setupLocalization,translatePhrase,currentLocale} from './ui/i18n';

const testing=import.meta.env.DEV&&new URLSearchParams(location.search).get('test')==='1';
let {slot,discoveryKey,systemSlot,systemResumeKey,checkpointKey}=saveScope(null,testing);
let cloud:FirebaseSaveStore|null=null,checkpoint:SyncCheckpoint|null=null,remoteSave:RemoteSave|null=null;
let cloudReady=false,cloudConflict=false,cloudMessage='',cloudLastAttempt=0,cloudTask:Promise<void>|null=null;
let accountPanel:AccountPanel|undefined;
let replacingSession=false;
let persistenceStamp=0;
function persistenceTime(){return persistenceStamp=Math.max(Date.now(),persistenceStamp+1);}
const resumeKey='sandsphere-resume'+(testing?'-test':'');
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`<div class="app">
<header class="topbar"><div class="brand-group"><div class="brand" title="Sandsphere ${APP_VERSION_LABEL}"><span class="brand-mark">${icon('planet')}</span>sandsphere<span class="brand-version">${APP_VERSION_LABEL}</span></div><button id="game-mode-open" class="mode-switch" aria-haspopup="dialog" title="게임 모드 선택">게임 모드</button><button class="sidebar-toggle" id="toggle-materials" aria-label="도구 패널 접기" aria-controls="materials-panel" aria-expanded="true" title="도구 패널 접기">${icon('panelLeft')}</button></div>${planetNavigationMarkup()}
<nav id="workbench-menu" class="top-actions" aria-label="실험실 메뉴"><button id="overview-open" aria-label="항성계" class="text-button" aria-pressed="false">${icon('orbit')}<span>항성계</span></button><button id="research-open" class="text-button" aria-haspopup="dialog">${icon('book')}<span>발견 기록</span><span id="discovery-count">0</span></button><button id="dashboard-open" class="icon-button" aria-label="행성 대시보드" title="행성 대시보드" aria-haspopup="dialog">${icon('chart')}</button><button id="notifications-open" class="icon-button notification-button" aria-label="알림 센터" aria-haspopup="dialog">${icon('bell')}<span id="notification-badge" class="notification-badge" aria-hidden="true" hidden>0</span></button><button id="account-open" class="icon-button" aria-label="계정과 저장" title="계정과 저장" aria-haspopup="dialog">${icon('save')}</button><button id="settings-open" class="icon-button" aria-label="설정" title="설정" aria-haspopup="dialog">${icon('settings')}</button></nav><button class="sidebar-toggle" id="toggle-observation" aria-label="관측 패널 접기" aria-controls="observation-panel" aria-expanded="true" title="관측 패널 접기">${icon('panelRight')}</button><button id="workbench-menu-toggle" class="icon-button" aria-label="실험실 메뉴" aria-controls="workbench-menu" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg></button></header>
<main class="view" data-sky="black" aria-label="구형 행성 실험"><canvas id="planet" tabindex="0" aria-label="행성. 기본은 그랩 모드입니다. 재료 선택 후 왼쪽 드래그로 붓기. 오른쪽 드래그로 회전. 휠로 확대. 터치에서는 한 손가락으로 붓고 두 손가락으로 회전합니다."></canvas>
<div id="system-labels" class="system-labels" hidden></div><div class="scene-heading"><div class="scene-mode-toolbar" role="toolbar" aria-label="행성 편집 모드"><button data-mode="grab" data-tool="observe" aria-pressed="true" aria-label="그랩" title="그랩 · 드래그로 시점 회전">${icon('hand')}<span>그랩</span></button><button id="observation-pin" data-mode="pin" aria-pressed="false" aria-describedby="observation-instruction" aria-label="관찰 핀" title="핀 · 표면을 눌러 관찰 지점 고정">${icon('pin')}<span>관찰 핀</span></button><button id="material-mode" data-mode="material" aria-pressed="false" aria-label="재료 붓기" title="재료 · 선택한 재료 붓기">${icon('pour')}<span>붓기</span></button></div><p id="scene-caption">모래를 부어보세요.</p>${sectionControlsMarkup()}${sectionSelectionMarkup()}<p id="observation-instruction" class="observation-instruction" role="status" hidden>행성 표면을 눌러 관찰 지점을 고정하세요. Esc로 취소</p></div><div id="observation-marker" class="observation-marker" hidden><button id="observation-focus" class="map-pin" aria-label="관찰 핀으로 시점 이동" title="이 핀 방향으로 시점 이동">${icon('pin')}</button><span class="pin-direction" aria-hidden="true">${icon('arrow')}</span><span id="observation-marker-location" class="pin-location" hidden></span><button id="observation-clear" aria-label="관찰 핀 삭제" title="관찰 핀 삭제">${icon('close')}</button></div><div id="solar-position" class="solar-position" role="img" aria-label="화면 밖 태양 방향" title="태양 방향 · 화면 밖" hidden>${icon('sun')}</div>

<div class="sun-label">${icon('sun')}<span>태양 에너지</span><output id="solar-energy">1.00×</output></div>
${sceneLayersMarkup()}${rotationStickMarkup()}</main>
<aside id="materials-panel" class="materials-panel" aria-label="물질과 도구"><div class="panel-title"><h2>실험 도구</h2><button id="quick-edit" class="quick-edit" aria-pressed="false">편집</button><button id="inventory-open" class="inventory-open">인벤토리 <span>↗</span></button><button id="settings-toggle" class="icon-button mobile-only" aria-label="실험 도구 닫기" title="도구 패널 접기">${icon('panelLeft')}</button></div>
<div class="material-categories" role="group" aria-label="물질 종류"><button data-category="surface" aria-pressed="true">표면 물질</button><button data-category="gas" aria-pressed="false">기체</button><button data-category="crafted" data-i18n-key="inventory.category.crafted" aria-pressed="false">발견</button></div>
<p id="selected-material-label" class="selected-material-label" role="status" hidden></p><div class="material-list" data-category="surface">${MATERIALS.map(m=>`<div class="quick-material" data-quick-material="${m.id}"><button class="material" data-material="${m.id}" data-material-category="${m.category}" aria-pressed="false" ${m.category!=='surface'?'hidden':''}><span class="material-icon" aria-hidden="true"></span><span><span class="material-name">${m.name}</span><span class="material-type">${m.type}</span></span><span class="material-supply${isProduct(m.id)?'':' supply-unlimited'}" data-supply="${m.id}" ${isProduct(m.id)?'':'aria-label="무제한"'}>${isProduct(m.id)?'0.0 kg':'∞'}</span></button><button class="quick-remove" data-quick-remove="${m.id}" aria-label="${m.name} 빠른 선택에서 제외" hidden>${icon('close')}</button></div>`).join('')}<button id="quick-add" class="quick-add" hidden>+ 추가</button></div>
<div class="tool-list">${[['heat','heat','가열'],['cool','snow','냉각'],['erase','erase','깎기'],['collect','collect','회수'],['meteor','planet','운석']].map(([tool,glyph,name])=>`<button class="tool" data-tool="${tool}" aria-label="${name}" aria-pressed="false">${icon(glyph)}<span>${name}</span></button>`).join('')}</div><div class="controls"><div class="control"><label for="radius" class="control-label">브러시 크기<output id="radius-value">1셀</output></label><input id="radius" type="range" min="0" max="5" step="1" value="0" aria-valuetext="1셀"></div>
<div id="pour-controls" class="control"><label for="rate" class="control-label"><span id="pour-rate-label">흐르는 양</span><output id="rate-value">80 kg/행성분</output></label><input id="rate" type="range" min="10" max="200" step="10" value="80"></div>
<div id="thermal-controls" class="control" hidden><label for="target" class="control-label">목표 온도<output id="target-value">950°C</output></label><input id="target" type="range" min="100" max="2100" step="50" value="950"></div>
</div><details class="expedition-disclosure"><summary>탐사 과제</summary>${expeditionMarkup()}</details></aside>
${inspectorMarkup()}
${planetControlsMarkup()}
<footer class="footer-meta"><span id="backend">준비 중</span><span class="tiny-dot"></span><span id="fps">— fps</span><span id="save-state" title="실험은 이 브라우저에 자동으로 이어집니다."></span></footer>
<div id="brush" class="brush" hidden></div><div id="cursor-label" class="cursor-label" hidden></div><p id="message" class="message" role="status" hidden></p>
<div id="boot" class="boot" role="status"><div class="loading-orb"></div><strong>작은 세계를 준비하고 있어요.</strong><p id="boot-message">지형과 물질을 불러오는 중</p></div>${firstStepsMarkup()}
<dialog id="research"><div class="dialog-header"><h2>발견 기록</h2><button class="icon-button dialog-close" aria-label="발견 기록 닫기">${icon('close')}</button></div><div class="dialog-body"><p class="dialog-lead">행성에서 발견한 물질과 현상입니다.<br>관측 조건과 과학적 근거를 함께 기록합니다.</p>${RESEARCH.map(r=>`<article class="research-entry" data-discovery="${r.id}"><h3>${icon(r.icon)}${r.name}<span class="discovery-state">미관측</span></h3><p>${r.science}</p><p>${r.rule}</p><p>${r.url?`<a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.source} ↗</a>`:`<span>${r.source}</span>`}</p></article>`).join('')}<article class="research-entry"><h3>행성의 물질량</h3><div class="mass-grid"><div><p>액체 물</p><output id="mass-water">—</output></div><div><p>얼음</p><output id="mass-ice">—</output></div><div><p>수증기</p><output id="mass-vapor">—</output></div><div><p>구름 · 물방울과 얼음</p><output id="mass-cloud">—</output></div><div><p>소금 · 고체와 용액</p><output id="mass-salt">—</output></div></div><p>사라진 물은 수증기나 얼음으로 이동합니다. 수증기는 구름 속 물방울·얼음이 되고, 충분히 모이면 비·눈으로 내려옵니다. 붓기·깎기·우주로의 탈출은 외부와의 물질 교환입니다.</p></article><p class="dialog-lead">구면 표면층 모델입니다. 생태계는 유기물·식생·초식·포식 생물의 질량과 먹이 관계로 계산합니다. 개체별 행동과 내부 동굴은 포함하지 않습니다.</p></div></dialog>
<dialog id="help"><div class="dialog-header"><h2>작은 세계 다루기</h2><button class="icon-button dialog-close" aria-label="조작 방법 닫기">${icon('close')}</button></div><div class="dialog-body"><p class="dialog-lead">물질을 골라 행성에 부어보세요.<br>실험은 자동으로 저장되고, 다음에 열면 이어집니다.</p>${[['그랩','기본 상태에서는 클릭해도 재료가 부어지지 않습니다. 왼쪽·오른쪽 드래그로 회전하세요.'],['붓기','재료를 선택한 뒤 왼쪽 버튼으로 누르거나 드래그. 그랩 또는 Esc로 해제'],['관찰 핀','행성 화면 좌상단의 핀을 누르고 표면을 눌러 고정하세요. 표면을 다시 누르거나 핀 해제로 관측 지점을 바꿀 수 있습니다.'],['회전','오른쪽 드래그 · 화면 오른쪽 아래 조이스틱'],['확대 · 축소','휠 또는 화면의 + / − 버튼'],['터치','한 손가락 붓기 · 두 손가락 회전'],['물질 · 작업 도구','물질과 가열·냉각·깎기·회수 버튼을 선택하세요.'],['생성물 재사용','생성물과 생물을 회수하고 전체 인벤토리에서 꺼내 쓰세요.'],['행성 이동','항성계에서 행성을 누르면 카메라가 해당 행성으로 이동합니다.'],['시간 · 시점','구면·단면 버튼으로 같은 세계를 연속 전환하세요. 단면은 표면을 확대해 보여줍니다. 그랩·오른쪽 드래그로 절단면을 두 축으로 돌리고 이동 버튼 또는 Shift+드래그로 화면을 옮기세요. 구면에서 단면을 누르면 절단선과 선택 셀이 나타납니다. A·B를 드래그하고 선택한 단면 열기를 누르세요. 끝점에 초점을 두고 방향키로도 조정할 수 있습니다. 행성 조정에서 절단 방향·기울기·띠 폭도 바꿀 수 있어요. 정지 중에는 클릭·드래그한 지점만 편집하며 반응과 낙하는 한 단계 또는 재생으로 진행합니다.'],['공전 · 자전','궤도 거리는 생성 후 고정되고 공전 주기를 정합니다. 하단의 행성 조정을 펼쳐 자전축과 자전 주기를 조절하세요. 동기 자전은 한쪽 면이 계속 태양을 보게 합니다. 화면 회전 고정은 관찰 화면만 멈추며, 실제 자전은 속도를 0으로 설정해야 멈춥니다.'],['행성 생성','항성계의 행성 만들기 버튼에서 주요 물질·궤도·대기·중력을 정하세요.'],['자연 현상','수증기 → 구름 → 비·눈. 구름은 이동하거나 다시 증발해요.'],['표시 레이어','화면 좌하단의 대기·구름·강수 버튼으로 숨기거나 표시하세요. 숨겨도 물질의 순환은 계속됩니다.']].map(([a,b])=>`<div class="key-row"><span>${a}</span><span>${b}</span></div>`).join('')}<details class="keyboard-help"><summary>키보드 보조 조작</summary><p>1–4 물질 선택 · G 가열 · C 냉각 · X 깎기 · Esc 그랩<br>Space 재생 · R 처음 시점 · P 관찰 핀 지정 · Shift+드래그 구면 회전 / 단면 이동<br>행성에 초점을 두면 방향키 회전 · Enter 붓기 (핀 지정 중에는 화면 중앙에 핀)</p></details><p class="dialog-lead help-example">점토를 붓고 가열 도구로 850°C 이상을 유지하면 도자기가 됩니다. 모래는 1,700°C 위에서 녹고 식으면 유리가 됩니다. 기본 목표는 현실 1초당 행성 시간 1분입니다. 계산이 느리면 하단에 실제 진행 속도가 따로 표시됩니다.</p></div></dialog>
<dialog id="placement"><div class="dialog-header"><h2>행성 만들기</h2><button class="icon-button dialog-close" aria-label="행성 만들기 닫기">${icon('close')}</button></div><div class="dialog-body">${firstExperimentMarkup()}<section class="placement-storage" aria-label="게임 저장"><p id="placement-storage-copy">이 브라우저에 자동 저장됩니다.</p><button id="placement-account" class="text-button" aria-haspopup="dialog">로그인·회원가입</button></section><label class="planet-name-field placement-name" for="placement-name">행성 이름<input id="placement-name" maxlength="28" required autocomplete="off"></label><p class="dialog-lead">무엇으로 이루어진 행성을 만들까요?</p><fieldset class="planet-materials"><legend>주요 구성 물질</legend>${[['rock','planet','암석'],['sand','sand','모래'],['clay','clay','점토'],['water','water','물'],['ice','snow','얼음']].map(([id,glyph,name])=>`<button type="button" data-primary="${id}" aria-pressed="${id==='rock'}">${icon(glyph)}<span>${name}</span></button>`).join('')}</fieldset><p class="placement-note">선택한 물질을 중심으로 지형과 표면층을 만듭니다. 얼음과 물의 상태는 배치한 궤도의 온도에 따라 변해요.</p>
<section class="orbit-placement"><h3>태양에서의 위치</h3><div class="orbit-spectrum" aria-hidden="true"><span class="placement-sun">${icon('sun')}</span><span id="placement-planet">${icon('planet')}</span></div><label for="placement-distance" class="control-label"><span>태양과의 거리</span><output id="placement-distance-value">1.00 AU</output></label><input id="placement-distance" type="range" min="0.65" max="2.4" step="0.05" value="1"><div class="placement-zones"><button data-distance="0.7">뜨겁게</button><button data-distance="1">온화하게</button><button data-distance="1.8">차갑게</button></div><div class="placement-readout"><span>받는 에너지 <output id="placement-energy">1.00×</output></span><span>초기 온도 <output id="placement-temperature">18°C</output></span><span>공전 주기 <output id="placement-period">4시간</output></span></div><p class="placement-note">궤도 거리는 생성 후 고정됩니다. 거리가 두 배면 에너지는 ¼. 온도와 시간은 게임용 근사값입니다.</p></section>
<details class="initial-atmosphere"><summary>초기 대기와 중력</summary><label for="placement-gas" class="control-label">대기 주성분</label><select id="placement-gas"><option value="nitrogen">질소 · N₂</option><option value="methane">메탄 · CH₄</option><option value="carbonDioxide">이산화탄소 · CO₂</option><option value="none">초기 대기 없음</option></select><div class="control"><label for="placement-gas-amount" class="control-label">초기 기체량<output id="placement-gas-value">1.0×</output></label><input id="placement-gas-amount" type="range" min="0.1" max="4" step="0.1" value="1"></div><div class="control"><label for="placement-gravity" class="control-label">중력 · 지구 기준<output id="placement-gravity-value">1.00×</output></label><input id="placement-gravity" type="range" min="0.01" max="3" step="0.01" value="1"></div></details><label class="placement-life"><input id="placement-life" type="checkbox">씨앗이 있는 행성</label><p class="placement-note">휴면 씨앗과 소량의 탄소원을 포함합니다. 물·빛·온도가 맞는 모래나 점토에서도 식생이 정착합니다.</p><button id="create-planet" class="create-planet">이 조건으로 행성 만들기</button><p id="placement-replace" class="placement-note">기존 행성을 보존하고 새 행성을 추가합니다. 최대 4개까지 함께 실험할 수 있어요.</p></div></dialog>
${systemDialog()}${inventoryMarkup()}${appDialogsMarkup()}${accountMarkup()}${dashboardMarkup()}</div>`;
setupLocalization();
function el<T extends HTMLElement=HTMLElement>(id:string) {return document.getElementById(id) as T;}
keepSceneLayersVisible();
const radiusInput=el<HTMLInputElement>('radius'),rateInput=el<HTMLInputElement>('rate');
const grid=createSphere(4);
let pausedEdited=false;
let material:Material='sand',tool:Tool='observe',paused=false,speed:SimulationSpeed=1,simTime=0,busy=false,operation=false,supplied=0,removed=0,escaped=0;
let latestActualRate:number|null=null;
const actualGameRate=new ActualGameRate();
const clock=new SimulationClock();
let climateLayer:ClimateLayer='none';
const weatherReadings=new WeatherReadings();
let environment={...environmentFor('coast'),climate:true} as Environment,solver:Solver=new CpuSolver(grid,seedWorld(grid));
let activeCommands:Float32Array|null=null;
let planets:PlanetRecord[]=[],activeId='planet-1',stock=emptyStock(),transferredIn=0,transferredOut=0,tidallyLocked=false;
const backgroundWorlds=new BackgroundWorlds(grid,async state=>{
 try{const worker=await WorkerSolver.create(grid,state,true);if(worker)return worker;}catch(error){console.warn('Background planet worker unavailable.',error);}
 return new CpuSolver(grid,state);
});
let overview=false,progress=freshProgress(),mode:GameMode='campaign',otherMode:ModeWorld|undefined,modeSelectionRequired=false;
let inventory:Inventory;
let firstSteps:FirstSteps;
let rotationStick:RotationStick;
let commands=new Float32Array(grid.count*COMMAND_STRIDE),currentStep:Promise<void>=Promise.resolve();
const observation=new ObservationPoint();
const surfaceRefresh=new SurfaceRefreshClock();
let selectionControls:SectionSelectionControls;
let view:PlanetView,lastObserver=-1,history:number[]=[],spinAngle=0,spinning=true,axisTilt=0,spinPeriod=120,primary:PlanetMaterial='rock',placementPrimary:PlanetMaterial='rock';
let showAtmosphere=true,showClouds=true,showPrecipitation=false,renderSpinFrozen=false,showAxis=true,lastSaved:Snapshot|null=null,saving=false,awaitingCreation=false;
let pointer={x:0,y:0,down:false};
// Briefly reserve the first contact for a possible two-finger camera gesture.
let touchPaintReadyAt=0;
const impactEnergy=new Float64Array(4);
const telemetry=new TelemetryStore();
let dashboard:PlanetDashboard|undefined;
let planetNavigation:PlanetNavigation|undefined;
let savedTelemetry:{savedAt:number;archive:TelemetryArchive}|undefined;
let telemetryRecoveryNotice=false;
let lastTelemetryEditSample=0;
const telemetrySupplyFields=Object.values(COMMAND_FIELD);
function sampleActivePlanet(force=false){
 if(!view||awaitingCreation||!planets.length)return;
 if(!force&&!telemetry.needsSample(activeId,simTime))return;
 let pending=0;for(let i=0;i<commands.length;i+=COMMAND_STRIDE)for(const field of telemetrySupplyFields)pending+=commands[i+field];
 const record=planets.find(p=>p.id===activeId)!;
 telemetry.sample(activeId,record.name,{time:simTime,state:solver.state,climate:solver.climate.snapshot(),environment,supplied,removed,escaped,transferredIn,transferredOut,airborne:view.deposits().reduce((sum,g)=>sum+g.amount,0),pending},force);
 dashboard?.render();
}
function seedTelemetry(){for(const p of planets){if(p.id===activeId)sampleActivePlanet(true);else if(!telemetry.planets.has(p.id)){const s=p.snapshot;telemetry.sample(p.id,p.name,{...s,state:new Float32Array(s.state),escaped:s.escaped??0,transferredIn:s.transferredIn??0,transferredOut:s.transferredOut??0});}}}
function sampleBackgroundPlanet(p:PlanetRecord,solver:Solver,dt:number){
 telemetry.step(p.id,dt,solver.energyChanges,solver.precipitatedCells);
 if(telemetry.needsSample(p.id,p.snapshot.time)){const s=p.snapshot;telemetry.sample(p.id,p.name,{...s,state:solver.state,escaped:s.escaped??0,transferredIn:s.transferredIn??0,transferredOut:s.transferredOut??0});dashboard?.render();}
}
const discoveries=new Set<string>();
const activeDiscoveryKey=()=>mode==='sandbox'?discoveryKey+'-sandbox':discoveryKey;
function loadDiscoveries(){try {const known=JSON.parse(localStorage.getItem(activeDiscoveryKey())??'[]');if(Array.isArray(known))for(const id of known)if(RESEARCH.some(r=>r.id===id))discoveries.add(id);}catch{}}
// Freezing the viewing frame is temporary interaction state, not a saved style.
// Old preferences may contain renderSpinFrozen; reopen with visible rotation.
try {const prefs=JSON.parse(localStorage.getItem('sandsphere-appearance')??'{}');showAtmosphere=prefs.atmosphere!==false;showClouds=prefs.clouds!==false;showPrecipitation=prefs.precipitation===true;showAxis=prefs.axis!==false;}catch{}
let activity:ActivityCenter|undefined;
let emphasizeNotifications=true,saveFailureNotified=false;
try{const prefs=JSON.parse(localStorage.getItem('sandsphere-appearance')??'{}');emphasizeNotifications=prefs.noticeEmphasis!==false;}catch{}
let messageTimer:ReturnType<typeof setTimeout>;
function message(text:string,error=false) {activity?.add({kind:error?'error':text.startsWith('탐사 완료')?'expedition':'system',title:text.replace(/^탐사 완료 · /,''),detail:'',glyph:error?'info':text.startsWith('탐사 완료')?'check':'planet'});const node=el('message');node.textContent=text;node.dataset.error=String(error);node.hidden=false;clearTimeout(messageTimer);messageTimer=setTimeout(()=>node.hidden=true,error?6500:3500);}
function discoveryNotice(id:string):NewNotice {
  const r=RESEARCH.find(r=>r.id===id)!;
  const detail:Record<string,string>={ice:'열이 빠져나가며 물이 얼었습니다.',ceramic:'점토가 소성되어 도자기가 되었습니다.',glass:'녹은 규사가 식어 유리가 되었습니다.',crystal:'물이 줄면서 소금 결정이 남았습니다.',evaporation:'물이 수증기로 이동하고 있습니다.',dissolution:'소금이 물에 녹았습니다.','wet-sand':'소량의 물이 모래 입자를 붙잡습니다.',atmosphere:'기체 조성과 양이 대기 높이에 반영됩니다.',cloud:'수증기가 구름 속 물방울·얼음으로 모였습니다.'};
  return {kind:'discovery',title:r.name+' 발견',detail:detail[id]??'',glyph:r.icon,target:id};
}
function planetNavigationUpdate(){planetNavigation?.update();}
function renamePlanet(id:string,name:string){
 const planet=planets.find(p=>p.id===id);if(!planet)return;planet.name=name;
 const record=telemetry.planets.get(id);if(record)record.name=name;
 planetNavigationUpdate();if(overview)renderSystemUi(planets,activeId,stock,mode);
 document.querySelectorAll<HTMLElement>('[data-scene-planet]').forEach(label=>{if(label.dataset.scenePlanet===id)label.textContent=name;});
 dashboard?.render(true);void autosave();
}
function settingsUiUpdate(){
  el<HTMLInputElement>('settings-notice-emphasis').checked=emphasizeNotifications;
}
function saveAppearance(){
  try{localStorage.setItem('sandsphere-appearance',JSON.stringify({theme:'dark',atmosphere:showAtmosphere,clouds:showClouds,precipitation:showPrecipitation,axis:showAxis,noticeEmphasis:emphasizeNotifications}));}catch{}
}
function updateMaterialModeTitle(){el('material-mode').title=currentLocale()==='en'?`Pour ${translatePhrase(MATERIALS.find(m=>m.id===material)!.name)} · click again to stop`:'재료 붓기 · '+MATERIALS.find(m=>m.id===material)!.name+' · 다시 눌러 해제';}
function updateSceneCaption(){
  const names={pour:{soil:'유기물을 뿌려보세요.',plant:'습한 모래나 점토에도 식생을 도입할 수 있어요.',herbivore:'식생이 자란 곳에 초식 생물을 놓으세요.',carnivore:'먹이가 있는 곳에 포식 생물을 놓으세요.',iron:'운철을 놓아보세요.',sand:'모래를 부어보세요.',water:'물을 부어보세요.',clay:'점토를 부어보세요.',salt:'소금을 부어보세요.',ice:'얼음을 놓아보세요.',ceramic:'도자기를 놓아보세요.',glass:'유리를 놓아보세요.',nitrogen:'질소를 대기에 공급하세요.',methane:'메탄을 대기에 공급하세요.',carbonDioxide:'이산화탄소를 대기에 공급하세요.'}[material],heat:'열빛과 수증기를 관찰하세요.',cool:'냉각해 얼음을 만들어보세요.',erase:'표면을 조금씩 깎아보세요.',collect:'표면의 생성물과 생물을 회수하세요.',meteor:'충돌시킬 지점을 누르세요.',observe:'드래그 · 시점 회전',orbit:''};
  const value=names[tool];el('scene-caption').textContent=currentLocale()==='en'?translatePhrase(value):value;
}
function setTool(next:Tool) {
  observation.selecting=false;
  tool=next;pointer.down=false;hideBrush();
  document.querySelectorAll<HTMLButtonElement>('button[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
  el('planet').dataset.tool=tool;view?.orbitMode(tool==='observe');
  el('planet').setAttribute('aria-label',tool==='observe'?'행성 그랩. 클릭해 관찰하고 드래그로 회전하세요. 재료를 선택해야 물질이 부어집니다.':'행성 작업. 선택한 재료나 도구로 표면을 수정합니다. 그랩 또는 Esc로 작업을 해제하세요.');
  document.querySelectorAll<HTMLButtonElement>('[data-material]').forEach(b=>b.setAttribute('aria-pressed',String(tool==='pour'&&b.dataset.material===material)));
  radiusInput.closest<HTMLElement>('.control')!.hidden=tool==='observe';
  el('pour-controls').hidden=tool!=='pour';el('thermal-controls').hidden=!['heat','cool'].includes(tool);
  const target=el<HTMLInputElement>('target');
  if(tool==='heat'){target.min='100';target.max='2100';target.step='50';target.value='950';}
  if(tool==='cool'){target.min='-30';target.max='20';target.step='1';target.value='-20';}
  el('target-value').textContent=target.value+'°C';updateRangeControl(target);
  updateSceneCaption();
  inventory?.setSelection(tool==='pour'?material:null);
  observationUiUpdate();
  if(view?.isSection)cameraViewUpdate();
  updateMaterialModeTitle();
}
function setMaterial(id:Material) {
  material=id;setTool('pour');const selected=MATERIALS.find(m=>m.id===id)!;
  document.querySelectorAll<HTMLButtonElement>('[data-material]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.material===id));});
  document.querySelectorAll<HTMLButtonElement>('button[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===selected.category)));
  rateUpdate();
  firstSteps?.selectedMaterial();
}
function renderDiscoveryRecords() {
  el('discovery-count').textContent=String(discoveries.size);
  el('research-open').setAttribute('aria-label','발견 기록 '+discoveries.size);
  for(const r of RESEARCH){const row=document.querySelector<HTMLElement>('[data-discovery="'+r.id+'"]')!;row.classList.toggle('discovered',discoveries.has(r.id));row.querySelector('.discovery-state')!.textContent=discoveries.has(r.id)?'발견함':'미관측';}
}
let oldTotals=totals(solver.state);
function discover() {
  const t=totals(solver.state),fresh:string[]=[];
  const mark=(id:string,condition:boolean)=>{if(condition&&!discoveries.has(id)){discoveries.add(id);fresh.push(id);}};
  let wetSand=false;
  for(let p=0;p<solver.state.length;p+=STRIDE){const w=solver.state[p+4]/Math.max(.1,solver.state[p]);if(solver.state[p]>.2&&w>.025&&w<.35){wetSand=true;break;}}
  mark('wet-sand',wetSand);mark('evaporation',t[F.vapor]>.1);mark('cloud',t[F.cloud]+t[F.cloudIce]>.1);mark('ice',t[F.ice]>.2);mark('dissolution',t[F.dissolved]-oldTotals[F.dissolved]>.01);
  mark('crystal',t[F.salt]-oldTotals[F.salt]>.005);mark('ceramic',t[F.ceramic]>.05);mark('glass',t[F.glass]>.05);oldTotals=t;
  for(const id of ['plant','herbivore','carnivore','iron'] as const)mark(id,t[F[id]]>.01);
  mark('atmosphere',t[F.methane]>.1||t[F.carbonDioxide]>.1||t[F.nitrogen]>grid.count*.3+.1);
  if(fresh.length){inventoryUpdate();renderDiscoveryRecords();try{localStorage.setItem(activeDiscoveryKey(),JSON.stringify([...discoveries]));}catch{}for(const id of fresh)activity?.add(discoveryNotice(id));}
}
function worldSun() {return orbitalSun(environment.orbitAngle??0);}
function updateSun() {environment.sun=localSun(spinAngle,axisTilt,environment.orbitAngle??0);environment.rotationRate=spinning?Math.PI*2/spinPeriod:0;}
function updateSpeedContext(){
  const display=el<HTMLOutputElement>('speed'),orbit=orbitalPeriod(environment.orbitDistance??1),index=SIMULATION_SPEEDS.indexOf(speed);
  display.textContent=speedLabel(speed);
  display.title=currentLocale()==='en'?`Target speed · ${spinning?'Rotation '+realDurationForPlanetPeriod(spinPeriod,speed):'Rotation stopped'} · Orbit ${realDurationForPlanetPeriod(orbit,speed)}`:`목표 속도 기준 · ${spinning?'자전 '+realDurationForPlanetPeriod(spinPeriod,speed):'자전 멈춤'} · 공전 ${realDurationForPlanetPeriod(orbit,speed)}`;
  const slower=el<HTMLButtonElement>('speed-decrease'),faster=el<HTMLButtonElement>('speed-increase');
  slower.disabled=index===0;faster.disabled=index===SIMULATION_SPEEDS.length-1;
  slower.title=index>0?`배속 낮추기 · ${speedLabel(SIMULATION_SPEEDS[index-1])}`:'가장 느린 배속';
  faster.title=index<SIMULATION_SPEEDS.length-1?`배속 높이기 · ${speedLabel(SIMULATION_SPEEDS[index+1])}`:'가장 빠른 배속';
  el('speed-context').textContent=latestActualRate===0?(currentLocale()==='en'?'No progress':'진행 없음'):`${currentLocale()==='en'?(latestActualRate===null?'Target':'Actual'):(latestActualRate===null?'목표':'실제')} ${spinning?(currentLocale()==='en'?'Rotation ':'자전 ')+realDurationForPlanetPeriod(spinPeriod,latestActualRate??speed):(currentLocale()==='en'?'Rotation stopped':'자전 멈춤')}`;
}
function changeSpeed(direction:-1|1){
  const next=SIMULATION_SPEEDS[SIMULATION_SPEEDS.indexOf(speed)+direction];if(next===undefined)return;
  speed=next;clock.reset();actualGameRate.reset();latestActualRate=null;el('game-rate').textContent='실제 측정 중';updateSpeedContext();
}
function environmentUpdate() {
  const distance=environment.orbitDistance??1;
  environment.sunlight=solarEnergy(distance);
  el('orbit-distance').textContent=distance.toFixed(2)+' AU';el('orbit-energy').textContent=environment.sunlight.toFixed(2)+'×';el('solar-energy').textContent=environment.sunlight.toFixed(2)+'×';
  el('planet-primary').textContent={rock:'암석',sand:'모래',clay:'점토',water:'물',ice:'얼음'}[primary];
  el('orbit-period').textContent=formatPlanetDuration(orbitalPeriod(distance));
  el('gravity-value').textContent=gravityMultiplier(environment).toFixed(2)+'×';
  updateSun();view?.setSun(worldSun());view?.setEnvironment(environment);updateSpeedContext();
}
function spinUpdate() {updateSun();el('spin').setAttribute('aria-pressed',String(renderSpinFrozen));el('spin-label').textContent=renderSpinFrozen?'화면 회전 재개':'화면 회전 고정';el('spin-angle').textContent=Math.round(spinAngle*180/Math.PI)+'°';el<HTMLInputElement>('axis-tilt').value=String(axisTilt);const axisInput=el<HTMLInputElement>('axis-number');if(document.activeElement!==axisInput&&!axisInput.hasAttribute('aria-invalid'))axisInput.value=String(axisTilt);el<HTMLInputElement>('spin-period').value=String(Math.round(spinPeriod));updateSyncPeriodMarker(orbitalPeriod(environment.orbitDistance??1),tidallyLocked,spinning);const periodInput=el<HTMLInputElement>('period-number');if(document.activeElement!==periodInput&&!periodInput.hasAttribute('aria-invalid'))periodInput.value=spinning?String(Math.round(spinPeriod)):'';periodInput.placeholder=spinning?'':'∞';const speedInput=el<HTMLInputElement>('spin-speed-number');if(document.activeElement!==speedInput&&!speedInput.hasAttribute('aria-invalid'))speedInput.value=spinning?String(Number((360/spinPeriod).toFixed(3))):'0';updateRangeControl(el<HTMLInputElement>('axis-tilt'));updateRangeControl(el<HTMLInputElement>('spin-period'));view?.setSpin(spinAngle,spinning,axisTilt);updateSpeedContext();}
function selectSpinPeriod(value:number,snapSeconds=0){
  const selected=spinPeriodSelection(value,orbitalPeriod(environment.orbitDistance??1),snapSeconds);
  tidallyLocked=selected.locked;spinPeriod=selected.period;spinning=true;
  if(tidallyLocked){spinning=true;spinAngle=environment.orbitAngle??0;axisTilt=0;el('axis-number').removeAttribute('aria-invalid');el('axis-error').hidden=true;}
}
function selectSpinSpeed(value:number){
  tidallyLocked=false;spinning=value>0;
  if(spinning)selectSpinPeriod(360/value);
}
function clearRotationErrors() {
  for(const [input,error] of [['axis-number','axis-error'],['period-number','period-error'],['spin-speed-number','spin-speed-error']]){
    el(input).removeAttribute('aria-invalid');el<HTMLInputElement>(input).setCustomValidity('');el(error).hidden=true;
  }
}
let brushWeightsCache:{grid:typeof grid;center:number;rings:number;weights:ReturnType<typeof cellBrushWeights>}|undefined;
function selectedBrushWeights(center:number,rings:number){
  if(!view.isSection){
    if(!brushWeightsCache||brushWeightsCache.grid!==grid||brushWeightsCache.center!==center||brushWeightsCache.rings!==rings)brushWeightsCache={grid,center,rings,weights:cellBrushWeights(grid,center,rings)};
    return brushWeightsCache.weights;
  }
  const weights=cellBrushWeights(grid,center,rings),allowed=new Set(view.sectionBrushCells(weights.map(w=>w.index))),selected=weights.filter(w=>allowed.has(w.index)),sum=selected.reduce((s,w)=>s+w.weight,0);
  return selected.map(w=>({...w,weight:w.weight/sum}));
}
function deposit(index:number,mass:number,kind:Material) {commands[index*COMMAND_STRIDE+COMMAND_FIELD[kind]]+=mass;}
function pour(dt:number,direction:readonly number[],kind=material,rate=Number(rateInput.value),rings=Number(radiusInput.value),center=nearestCell(grid,direction[0],direction[1],direction[2])) {
  const weights=selectedBrushWeights(center,rings);if(!weights.length)return;
  const requested=rate*dt,{amount,fromStock}=materialSupply(mode,kind,stock,requested);
  if(fromStock&&isProduct(kind)){
    if(amount<=0)return;
    stock[kind]-=amount;transferredIn+=amount;inventoryUpdate();
  }else supplied+=amount;
  if(amount>0)firstSteps?.poured();
  if(isGas(kind)){for(const {index,weight} of weights)deposit(index,amount*weight,kind);view.emitGas(center,kind,amount);return;}
  if(amount<=0)return;
  const land=(cell:number,mass:number)=>deposit(cell,mass,kind);
  // Surface and air picks use the same bounded brush delivery. No physical
  // dust is created by the editing tool, even while paused or at low gravity.
  view.supplySurface(weights,kind,amount,land);
}
let brushCell:number|null=null,brushHover=false,brushRefreshPending=false,lastBrushRefresh=0;
function brushSizeUpdate(){
  const rings=Number(radiusInput.value),text=brushCell===null?(rings===0?'1셀':rings+'겹 확장'):selectedBrushWeights(brushCell,rings).length+'셀';
  el('radius-value').textContent=text;radiusInput.setAttribute('aria-valuetext',text);updateRangeControl(radiusInput);
}
function hideBrush(){brushHover=false;brushRefreshPending=false;brushCell=null;view?.setBrushCells([]);el('brush').hidden=true;el('cursor-label').hidden=true;brushSizeUpdate();}
function showBrush(hit:ReturnType<PlanetView['pick']>){
  const visible=!!hit&&!overview&&!view.isSelectingSection&&!observation.selecting&&tool!=='observe';
  if(!visible){hideBrush();return;}
  brushHover=true;brushCell=hit!.index;brushSizeUpdate();
  const cells=selectedBrushWeights(hit!.index,Number(radiusInput.value)),surface=!hit!.inAir&&tool!=='meteor';
  view.setBrushCells(surface?cells.map(c=>c.index):[],tool);
  const brush=el('brush'),label=el('cursor-label'),size=Math.max(12,view.brushPixels(cellBrushAngle(grid,hit!.index,Number(radiusInput.value))));
  brush.hidden=surface;brush.dataset.kind=tool;brush.style.left=pointer.x+'px';brush.style.top=pointer.y+'px';brush.style.width=size+'px';brush.style.height=size+'px';
  label.hidden=false;label.textContent=(tool==='heat'||tool==='cool'?el<HTMLInputElement>('target').value+'°C':tool==='erase'?'깎기':tool==='collect'?'회수':tool==='meteor'?'운석':MATERIALS.find(m=>m.id===material)!.name)+(tool==='meteor'?'':' · '+cells.length+'셀');
  label.style.left=pointer.x+18+'px';label.style.top=pointer.y+'px';
}
function refreshBrush(){const r=view.canvas.getBoundingClientRect();showBrush(view.pick(pointer.x-r.left,pointer.y-r.top));}
function paint(dt:number) {
  if(operation||overview||view.isSelectingSection||observation.selecting||tool==='observe'||performance.now()<touchPaintReadyAt)return;const rect=view.canvas.getBoundingClientRect(),hit=view.pick(pointer.x-rect.left,pointer.y-rect.top);if(!hit)return;if(!hit.inAir)observation.hover(hit.index);
  showBrush(hit);lastBrushRefresh=performance.now();brushRefreshPending=false;
  if(tool==='meteor'){pointer.down=false;void meteorImpact(hit.direction);return;}
  if(paused&&(tool==='pour'||!hit.inAir))pausedEdited=true;
  if(tool==='pour')pour(dt,hit.direction,material,Number(rateInput.value),Number(radiusInput.value),hit.index);
  else {if(hit.inAir)return;const weights=selectedBrushWeights(hit.index,Number(radiusInput.value));
    if(tool==='heat'||tool==='cool'){const target=Number(el<HTMLInputElement>('target').value);for(const {index,weight} of weights){const heat=heatForTarget(solver.state,index,target,tool,commands,activeCommands,!!environment.climate);commands[index*COMMAND_STRIDE+4]+=heat*(paused?1:Math.min(1,dt*8))*Math.min(1,weight*weights.length);}}
    if(tool==='collect')for(const {index,weight} of weights){const c=index*COMMAND_STRIDE+6,amount=Math.min(.95,dt*2*Math.min(1,weight*weights.length));commands[c]=1-(1-commands[c])*(1-amount);}
    if(tool==='erase')for(const {index,weight} of weights){if(view.isSection)commands[index*COMMAND_STRIDE+SURFACE_ERASE]=1;const c=index*COMMAND_STRIDE+5,amount=Math.min(.95,dt*2*Math.min(1,weight*weights.length));commands[c]=1-(1-commands[c])*(1-amount);}
  }
}
async function tick(dt:number) {
  if(dt>0){
    pausedEdited=false;
    environment.orbitAngle=((environment.orbitAngle??0)+dt*Math.PI*2/orbitalPeriod(environment.orbitDistance??1))%(Math.PI*2);
    if(tidallyLocked){spinAngle=environment.orbitAngle;spinPeriod=orbitalPeriod(environment.orbitDistance??1);axisTilt=0;spinning=true;}
    else if(spinning)spinAngle=(spinAngle+dt*Math.PI*2/spinPeriod)%(Math.PI*2);
    updateSun();
    view.stepPhysics(dt);escaped+=view.takeEscapedGrains();
    if(pointer.down&&!paused)paint(dt);
  }
  const batch=commands;commands=new Float32Array(grid.count*COMMAND_STRIDE);activeCommands=batch;
  const accounting=batch.some((v,i)=>v!==0&&(i%COMMAND_STRIDE===5||i%COMMAND_STRIDE===6));
  const transfer=accounting?snapshotSurface(solver.state,batch,[]):{pendingRemoved:0,collected:emptyStock()},cut=transfer.pendingRemoved;
  try{await solver.step(dt,batch,environment);}catch(error){
    console.warn('Compute stopped; continuing from the last complete state.',error);
    const state=solver.state,climate=solver.climate.checkpoint(),lift=solver.climate.lift.slice();solver.dispose();
    let replacement:Solver|null=null;
    try{replacement=await WorkerSolver.create(grid,state,true);}catch(workerError){console.warn('Background CPU compute unavailable.',workerError);}
    solver=replacement??new CpuSolver(grid,state);solver.climate.restoreCheckpoint(climate);solver.climate.lift.set(lift);
    await solver.step(dt,batch,environment);el('backend').textContent='CPU';view.setClimate(climateLayer,solver.climate);message('CPU 계산으로 계속하고 있어요.',true);
  }finally{activeCommands=null;}
  let discoveredByCollection=false;
  for(const id of PRODUCTS){stock[id]+=transfer.collected[id];transferredOut+=transfer.collected[id];if(transfer.collected[id]>.00001&&!discoveries.has(id)){discoveries.add(id);discoveredByCollection=true;}}
  if(discoveredByCollection)renderDiscoveryRecords();
  if(accounting)inventoryUpdate();
  removed+=cut;escaped+=solver.escapeCells.reduce((sum,v)=>sum+v,0);simTime+=dt;view.setTime(simTime);view.syncState(solver.state,environment);surfaceRefresh.mark(dt);view.showEscape(solver.escapeCells);if(dt>0)view.showRain(solver.precipitatedCells,dt);discover();
  weatherReadings.record(dt,solver.condensedCells,solver.precipitatedCells);telemetry.step(activeId,dt,solver.energyChanges,solver.precipitatedCells);
  if(dt>0)sampleActivePlanet();else if(performance.now()-lastTelemetryEditSample>=500){lastTelemetryEditSample=performance.now();sampleActivePlanet(true);}
}
function observerUpdate() {
  planetNavigationUpdate();
  if(overview){updateSystemUi(planets,stock,mode);return;}
  spinUpdate();
  const observed=observation.cell,p=observed*STRIDE,s=solver.state;updateObservatory(s,observed,environment,grid,solver.climate,view.isSection);let name='기반암',phase='고체';
  if(s[p+F.sand]>.3)name=s[p+F.water]>.03?'젖은 모래':'모래';if(s[p+F.clay]>.5)name=s[p+F.water]>.03?'젖은 점토':'점토';
  if(s[p+F.soil]>.3)name='유기물';if(s[p+F.plant]>.1)name='식생';if(s[p+F.iron]>.3)name='운철';
  if(s[p+F.ceramic]>.5)name='도자기';if(s[p+F.glass]>.5)name='유리';if(s[p+F.salt]>.4)name='소금 결정';if(s[p+F.water]>.3){name=s[p+F.dissolved]>.01?'염수':'물';phase='액체';}if(s[p+F.ice]>.3){name='얼음';phase='고체';}if(s[p+F.molten]>.3){name='용융 실리카';phase='용융';}
  el('observed-name').textContent=name;el('observed-phase').textContent=phase;el('temperature').textContent=(Math.abs(s[p+8])<.05?0:s[p+8]).toFixed(1);
  el('temperature').parentElement!.dataset.hot=String(s[p+8]>45);
  const limits=phaseLimitNotes(s,p,gravityMultiplier(environment));el('phase-limit').hidden=limits.length===0;el('phase-limit').textContent=limits.join(' · ');if(limits.length)el('observed-phase').textContent='상 모델 제한';
  const pressure=cellPressure(s,observed,environment);el('local-pressure').textContent=(pressure/REFERENCE_PRESSURE).toFixed(3)+' atm';el('local-boiling').textContent=boilingPoint(pressure,waterActivity(s[p+4],s[p+7])).toFixed(1)+'°C'+(pressure<612?' · 삼중점 이하 근사':pressure/waterActivity(s[p+4],s[p+7])>saturationPressure(180)?' · 180°C 상한 근사':'');
  el('phase-note').textContent=paused?(pausedEdited?'편집 적용 · 다음 단계에서 반응':'시간이 멈춰 있어요.'):s[p+F.firing]>0?(s[p+8]>=850&&s[p+4]/Math.max(.1,s[p+F.clay])<.008?'점토가 소성되고 있어요.':'식어서 소성이 멈춰있어요.'):s[p+F.molten]>.1?(s[p+8]>1400?'용융 실리카가 온도에 따른 점성으로 흐릅니다.':'용융 실리카가 식으며 유리로 굳고 있어요.'):s[p+F.water]>.05&&s[p+8]>35?'물이 수증기로 이동하고 있어요.':s[p+F.ice]>.1?'얼음과 물의 상태를 관측 중이에요.':'';
  el('phase-note').hidden=!el('phase-note').textContent;
  const moisture=Math.min(100,s[p+4]/Math.max(.1,s[p]+s[p+1]+s[p+F.soil]+s[p+4])*100);el('moisture').textContent=moisture.toFixed(1)+'%';el('moisture-bar').style.width=moisture+'%';el('salinity').textContent=(100*s[p+7]/Math.max(.0001,s[p+4]+s[p+7])).toFixed(1)+'%';
  el('firing-row').hidden=s[p+10]<=0;el('firing').textContent=Math.min(100,s[p+10]/30*100).toFixed(0)+'%';
  if(lastObserver!==observed){history=[];lastObserver=observed;}history.push(s[p+8]);if(history.length>80)history.shift();const low=Math.min(...history)-.5,high=Math.max(...history)+.5;el('temperature-history').setAttribute('d',history.map((t,i)=>(i?'L':'M')+(i/Math.max(1,history.length-1)*200).toFixed(2)+' '+(33-(t-low)/(high-low)*30).toFixed(2)).join(' '));
  const cloudStock=updateWeatherReadout(s,grid.count,weatherReadings.pulse,paused,pausedEdited);
  const atmosphere=atmosphereState(s,environment,solver.climate),dominant=[...atmosphere.species].sort((a,b)=>b.fraction-a.fraction)[0];
  sceneLayerLegendUpdate(atmosphere,cloudStock);
  el('atmosphere-summary').textContent=atmosphere.mass>.01?GASES.find(g=>g.id===dominant.id)!.name+' '+(dominant.fraction*100).toFixed(0)+'%':'기체 없음';
  el('escaped-mass').textContent=escaped.toFixed(1)+' kg';setMetric('atmosphere-mass',formatReading(atmosphere.mass,1));setMetric('atmosphere-pressure',formatReading(atmosphere.pressure,3));el('atmosphere-height').textContent=atmosphereReadout(atmosphere).height;el('atmosphere-model').textContent=atmosphereReadout(atmosphere).regime;el('atmosphere-boundary-note').textContent=atmosphereReadout(atmosphere).note;el('atmosphere-binding').textContent=atmosphere.mass>0?atmosphere.minimumBinding.toFixed(2):'—';el('gas-temperature').textContent=atmosphere.mass>0?atmosphere.temperature.toFixed(1)+'°C':'—';
  const exposure=Math.max(0,grid.directions[observed*3]*environment.sun[0]+grid.directions[observed*3+1]*environment.sun[1]+grid.directions[observed*3+2]*environment.sun[2]);
  el('bath-target').textContent=environment.climate?(solver.climate.air.ready?solver.climate.air.surfaceRadiativeTarget(s,observed,environment).toFixed(1)+'°C':'—'):thermalTarget(environment.ambient,environment.sunlight,transmittedLight(exposure,environment.sunlight,s[p+F.cloud],s[p+F.cloudIce]),albedo(s,p)).toFixed(1)+'°C';
  for(const [k,id] of ['energy-environment','energy-command','energy-escape','energy-numerical'].entries())el(id).textContent=solver.energyChanges[observed*4+k].toFixed(4)+' kJ';
  el('local-escaped').textContent=solver.escapeCells.slice(observed*4,observed*4+4).reduce((a,b)=>a+b,0).toPrecision(3)+' kg';
  document.querySelector('.gas-mixture')!.setAttribute('aria-label','기체 조성: '+atmosphere.species.map(gas=>GASES.find(g=>g.id===gas.id)!.name+' '+(gas.fraction*100).toFixed(1)+'%').join(', '));for(const gas of atmosphere.species){el('gas-share-'+gas.id).textContent=(gas.fraction*100).toFixed(1)+'%';el('gas-'+gas.id).textContent=(gas.fraction*100).toFixed(1)+'% · '+gas.mass.toFixed(1)+' kg';document.querySelector<HTMLElement>('[data-gas-fraction="'+gas.id+'"]')!.style.width=gas.fraction*100+'%';}
  if(overview){const record=planets.find(p=>p.id===activeId);if(record)record.snapshot=capture();updateSystemUi(planets,stock,mode);}
  if(el<HTMLDialogElement>('research').open){const t=totals(s);for(const [id,value] of [['water',t[4]],['ice',t[5]],['vapor',t[9]],['cloud',t[F.cloud]+t[F.cloudIce]],['salt',t[6]+t[7]]] as const)el('mass-'+id).textContent=value.toFixed(1)+' kg';}
}
function capture():Snapshot {
  const {state,pendingRemoved,collected,climate}=snapshotSurface(solver.state,commands,view.deposits(),activeCommands,solver.climate,environment);
  return {version:4,climate:climate??solver.climate.snapshot(),preset:'coast',planet:{primary},time:simTime,state:[...state],discoveries:[...discoveries],environment:{...environment,sun:[...environment.sun]},supplied,removed:removed+pendingRemoved,escaped,transferredIn,transferredOut:transferredOut+Object.values(collected).reduce((a,b)=>a+b,0),savedAt:Date.now(),paused,spin:{angle:spinAngle,running:spinning,tilt:axisTilt,period:spinPeriod,locked:tidallyLocked}};
}
function captureSystem():SystemSave {
  const snapshot=capture(),collected=snapshotSurface(solver.state,commands,view.deposits(),activeCommands,solver.climate,environment).collected;
  return {version:3,mode,other:otherMode?structuredClone(otherMode):undefined,progress:structuredClone(progress),activeId,planets:planets.map(p=>p.id===activeId?{...p,snapshot}:structuredClone(p)),stock:Object.fromEntries(PRODUCTS.map(id=>[id,stock[id]+collected[id]])) as typeof stock,savedAt:persistenceTime()};
}
function capturePersistedSystem(journal=false):SystemSave {
 const system=prepareSystemSave(captureSystem(),grid.count);
 system.telemetry=archiveTelemetry(telemetry,system.planets.map(p=>{const s=p.snapshot,state=new Float32Array(s.state);return {id:p.id,name:p.name,input:{...s,state,escaped:s.escaped??0,transferredIn:s.transferredIn??0,transferredOut:s.transferredOut??0},settledEnergy:p.id===activeId?totalEnthalpy(state,s.climate)-totalEnthalpy(solver.state,solver.climate):0};}),journal?savedTelemetry:undefined);
 return system;
}
async function autosave() {
  if(!view||saving||operation||awaitingCreation||!planets.length)return;saving=true;
  try{await currentStep;const system=capturePersistedSystem();await saveSnapshot(system,systemSlot,savedTelemetry?{slot:systemSlot+'-telemetry-base',value:savedTelemetry}:undefined);savedTelemetry={savedAt:system.savedAt,archive:system.telemetry!};lastSaved=system.planets.find(p=>p.id===activeId)!.snapshot;if(cloud&&cloudReady&&!cloudConflict&&Date.now()-cloudLastAttempt>=60000)void uploadCloud(system).catch(cloudError);el('save-state').textContent='· 이어짐';el('save-state').title='행성과 대시보드 기록이 이 브라우저에 자동 저장됨';if(saveFailureNotified)activity?.add({kind:'system',title:'자동 저장이 다시 정상 동작합니다.',detail:'',glyph:'save'});saveFailureNotified=false;}
  catch(error){el('save-state').textContent='· 저장 불가';if(!saveFailureNotified){activity?.add({kind:'error',title:'자동 저장하지 못했습니다.',detail:'브라우저의 저장 공간과 저장 권한을 확인하세요.',glyph:'save'});saveFailureNotified=true;}console.warn('Automatic persistence unavailable.',error);}finally{saving=false;}
}
function setCheckpoint(revision:string|null,syncedAt:number){
 checkpoint={revision,syncedAt};try{localStorage.setItem(checkpointKey,JSON.stringify(checkpoint));}catch{}
}
function cloudError(error:unknown){
 if(error instanceof SaveConflict){cloudConflict=true;accountPanel?.conflict(true);}
 accountPanel?.status(error instanceof SaveConflict?error.message:'클라우드 저장에 실패했습니다. 이 기기에 게임을 보관했으며 지금 저장에서 다시 시도할 수 있습니다.');
 console.warn('Cloud persistence unavailable.',error);
}
function uploadCloud(system:SystemSave):Promise<void>{
 if(cloudTask)return cloudTask;
 if(!cloud||!cloudReady||cloudConflict)return Promise.reject(new Error('클라우드 저장본을 먼저 확인하세요.'));
 const store=cloud,expected=checkpoint?.revision??null;cloudLastAttempt=Date.now();
 accountPanel?.status('클라우드에 저장 중…');
  cloudTask=store.write(system,expected).then(revision=>{setCheckpoint(revision,system.savedAt);accountPanel?.status('클라우드에 저장했습니다. · '+new Date().toLocaleTimeString(currentLocale()==='en'?'en-US':'ko-KR'));}).finally(()=>cloudTask=null);
 return cloudTask;
}
async function preserveLocal(){
 await currentStep;if(!view||awaitingCreation||!planets.length)return;
 // The synchronous resume key also survives an interrupted account transition.
 const system=capturePersistedSystem();try{localStorage.setItem(systemResumeKey,JSON.stringify(system));}catch(error){console.warn('Immediate account checkpoint unavailable; IndexedDB remains the primary store.',error);}
 // Wait for a periodic write before writing a newer snapshot to the same slot.
 while(saving)await new Promise(resolve=>setTimeout(resolve,20));
 await saveSnapshot(system,systemSlot);return system;
}
async function preserveAndReload(){
 operation=true;pointer.down=false;
 try{await preserveLocal();}catch(error){console.warn('Account transition checkpoint failed.',error);}
 replacingSession=true;location.reload();
}
function modeUiUpdate(){
 document.querySelector('.expedition-disclosure')!.toggleAttribute('hidden',mode==='sandbox');
 document.querySelectorAll<HTMLButtonElement>('[data-game-mode]').forEach(button=>{
  const current=button.dataset.gameMode===mode;
  button.setAttribute('aria-current',String(current));
  button.querySelector<HTMLElement>('.mode-current')!.hidden=!current;
 });
 inventoryUpdate();
}
async function selectGameMode(target:GameMode){
 if(operation)return;
 if(!planets.length){
  operation=true;
  try{
   const initialStock=emptyStock();if(target==='campaign')initialStock.plant=8;
   const initial=prepareSystemSave({version:3,mode:target,activeId:'',planets:[],stock:initialStock,progress:freshProgress(),savedAt:persistenceTime()},grid.count);
   await saveSnapshot(initial,systemSlot);
   try{localStorage.setItem(systemResumeKey,JSON.stringify(initial));}catch{}
   replacingSession=true;location.reload();
  }catch(error){operation=false;message(error instanceof Error?error.message:'모드를 저장하지 못했습니다.',true);}
  return;
 }
 el<HTMLDialogElement>('game-mode').close();
 if(mode===target)return;
 operation=true;pointer.down=false;
 try{
  await currentStep;
  while(saving)await new Promise(resolve=>setTimeout(resolve,20));
  if(cloudTask)await cloudTask.catch(()=>{});
  const switched=prepareSystemSave(switchSystemMode(capturePersistedSystem(),target,persistenceTime()),grid.count);
  await saveSnapshot(switched,systemSlot);
  try{localStorage.setItem(systemResumeKey,JSON.stringify(switched));}catch{}
  replacingSession=true;location.reload();
 }catch(error){operation=false;message(error instanceof Error?error.message:'모드를 바꾸지 못했습니다.',true);}
}
async function replaceWithRemote(remote:RemoteSave){
 operation=true;pointer.down=false;
 try{const local=await preserveLocal();if(local)await saveSnapshot(local,systemSlot+'-before-cloud');
   await saveSnapshot(remote.system,systemSlot);localStorage.removeItem(systemResumeKey);setCheckpoint(remote.revision,remote.system.savedAt);replacingSession=true;location.reload();
 }catch(error){operation=false;throw error;}
}
async function syncNow(){
 if(!cloud)return;
 if(cloudTask)await cloudTask;
 if(cloudConflict)throw new SaveConflict();
 if(!cloudReady){remoteSave=await cloud.read();cloudReady=true;const local=await preserveLocal();
   const decision=chooseSave(local??null,remoteSave,checkpoint);
   if(decision==='remote'){await replaceWithRemote(remoteSave!);return;}
   if(decision==='conflict'){cloudConflict=true;accountPanel?.conflict(true);throw new SaveConflict();}
 }
 const system=await preserveLocal();if(system)await uploadCloud(system);else accountPanel?.status('먼저 행성을 만들거나 비회원 게임을 가져오세요.');
}
function setupAccount(services:ReturnType<typeof firebaseServices>){
 accountPanel=new AccountPanel(services,{
  beforeAuth:async()=>{const system=await preserveLocal();if(cloud&&cloudReady&&!cloudConflict&&system){let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([uploadCloud(system).catch(cloudError),new Promise<void>(resolve=>{timer=setTimeout(resolve,8000);})]).finally(()=>clearTimeout(timer));}},
  sync:async()=>{try{await syncNow();}catch(error){cloudError(error);throw error;}},
  useCloud:async()=>{if(!cloud)return;const remote=await cloud.read();if(!remote)throw new Error('클라우드 저장본이 없습니다.');await replaceWithRemote(remote);},
  useLocal:async()=>{if(!cloud)return;if(cloudTask)await cloudTask.catch(()=>{});const remote=await cloud.read(),local=await preserveLocal();if(!local)throw new Error('이 기기에 저장된 게임이 없습니다.');await saveSnapshot(local,systemSlot+'-before-cloud-choice');setCheckpoint(remote?.revision??null,checkpoint?.syncedAt??0);cloudReady=true;cloudConflict=false;try{await uploadCloud(local);accountPanel?.conflict(false);}catch(error){cloudError(error);throw error;}},
  importGuest:async()=>{
   if(!cloud)return;const remote=await cloud.read();if(remote||planets.length)throw new Error('현재 계정에 게임이 있습니다. 비회원 게임 가져오기는 빈 계정에서만 가능합니다.');
   const disk=await loadRecord('latest-system');let local:unknown;try{local=JSON.parse(localStorage.getItem('sandsphere-system-resume')??'null');}catch{}
   let guest=validSystem(local,grid.count)&&local.savedAt>(validSystem(disk,grid.count)?disk.savedAt:0)?local:validSystem(disk,grid.count)?disk:null;
   if(!guest){const legacy=await loadSnapshot(grid.count);if(legacy)guest=migrateWorld(legacy,grid.count);}
   if(!guest)throw new Error('이 브라우저에 비회원 게임이 없습니다.');
   const complete=prepareSystemSave(guest,grid.count),store=new TelemetryStore();
   const base=guest.telemetry?.baseSavedAt===(disk as SystemSave|undefined)?.savedAt?{savedAt:(disk as SystemSave).savedAt,archive:(disk as SystemSave).telemetry}:await loadRecord('latest-system-telemetry-base') as {savedAt:number;archive:unknown}|undefined;
   restoreTelemetry(store,guest.telemetry,guest.planets.map(p=>({id:p.id,name:p.name,time:p.snapshot.time})),base);
   complete.telemetry=archiveTelemetry(store,complete.planets.map(p=>({id:p.id,name:p.name,input:{...p.snapshot,state:new Float32Array(p.snapshot.state),escaped:p.snapshot.escaped??0,transferredIn:p.snapshot.transferredIn??0,transferredOut:p.snapshot.transferredOut??0}})));
   const revision=await cloud.write(complete,null);await replaceWithRemote({revision,system:complete});
  }
 });
 if(cloud){accountPanel.status(cloudMessage);accountPanel.conflict(cloudConflict);}
 el('placement-account').addEventListener('click',()=>accountPanel?.open());
}
function resume(snapshot:Snapshot) {
  snapshot=upgradeSnapshot(snapshot,grid.count);
  spherizeLegacyRockPlanet(snapshot,grid);
  solver.replace(new Float32Array(snapshot.state));solver.climate.restore(snapshot.climate);simTime=snapshot.time;supplied=snapshot.supplied;removed=snapshot.removed;escaped=snapshot.escaped??0;transferredIn=snapshot.transferredIn??0;transferredOut=snapshot.transferredOut??0;tidallyLocked=snapshot.spin?.locked??false;environment={...snapshot.environment,climate:true};for(const id of snapshot.discoveries)discoveries.add(id);
  primary=snapshot.planet?.primary??'rock';
  environment.gravity??=1;
  environment.orbitDistance??=Math.max(.65,Math.min(2.4,1/Math.sqrt(Math.max(.174,snapshot.weather?.sunlight??environment.sunlight))));
  environment.sunlight=solarEnergy(environment.orbitDistance);environment.ambient=orbitalEnvironment(environment.orbitDistance,gravityMultiplier(environment)).ambient;
  if(snapshot.spin){spinAngle=snapshot.spin.angle;spinning=snapshot.spin.running;axisTilt=snapshot.spin.tilt??0;spinPeriod=snapshot.spin.period??Math.round(Math.PI*2/.06);}
  oldTotals=totals(solver.state);
  paused=snapshot.paused===true;

}
function stashCurrent(settle=false){
  const pending=settle?snapshotSurface(solver.state,commands,view.deposits(),activeCommands,solver.climate,environment):null;
  const record=planets.find(p=>p.id===activeId);if(record){record.snapshot=capture();if(settle){const s=record.snapshot;telemetry.externalEnergy(activeId,[0,totalEnthalpy(new Float32Array(s.state),s.climate)-totalEnthalpy(solver.state,solver.climate),0,0]);telemetry.sample(activeId,record.name,{...s,state:new Float32Array(s.state),escaped:s.escaped??0,transferredIn:s.transferredIn??0,transferredOut:s.transferredOut??0},true);}}
  backgroundWorlds.invalidate(activeId);
  if(pending){for(const id of PRODUCTS)stock[id]+=pending.collected[id];commands.fill(0);view.clearGrains();}
}
function refreshWorld(resetCamera=true){
  weatherReadings.reset();
  surfaceRefresh.reset();view.resetRenderSpin(spinAngle);
  observation.switchPlanet(activeId);observationUiUpdate();
  commands.fill(0);view.clearGrains();view.clearPrecipitation();history=[];clearRotationErrors();environmentUpdate();view.setTime(simTime);view.update(solver.state,0,environment);view.setClimate(climateLayer,solver.climate);if(resetCamera)view.home();spinUpdate();
  const wasPaused=paused;paused=!wasPaused;pauseToggle();
  el<HTMLButtonElement>('dashboard-open').disabled=!planets.length;seedTelemetry();inventoryUpdate();observerUpdate();renderDiscoveryRecords();discover();
}
async function switchPlanet(id:string){
 if(operation)return;const destination=planets.find(p=>p.id===id);if(!destination)return;
 operation=true;pointer.down=false;
 try{
  await currentStep;stashCurrent(true);
  if(overview)await view.approachPlanet(id);
  view.clearSectionSelection();activeId=id;backgroundWorlds.invalidate(id);resume(destination.snapshot);view.leaveSystem();overview=false;el('system-labels').hidden=true;
  document.querySelector('.app')!.classList.remove('system-view');el('system-dialog').hidden=true;el('overview-open').setAttribute('aria-pressed','false');refreshWorld(false);
 }finally{operation=false;}void autosave();
}
async function meteorImpact(direction:readonly number[]){
 if(operation)return;operation=true;pointer.down=false;
 try{
  await view.meteor(direction);await currentStep;
  const beforeEnergy=totalEnthalpy(solver.state,solver.climate),priorImpact=[...impactEnergy];
  const pending=snapshotSurface(solver.state,commands,view.deposits()),settled=capture();resume(settled);for(const id of PRODUCTS)stock[id]+=pending.collected[id];
  const settledEnergy=totalEnthalpy(solver.state,solver.climate)-beforeEnergy;
  commands.fill(0);view.clearGrains();solver.replace(impactMeteor(solver.state,grid,direction,36,impactEnergy,solver.climate));supplied+=36;if(mode==='campaign')progress.meteorCount++;if(paused)pausedEdited=true;
  telemetry.externalEnergy(activeId,[impactEnergy[0]-priorImpact[0],settledEnergy+impactEnergy[1]-priorImpact[1],impactEnergy[2]-priorImpact[2],impactEnergy[3]-priorImpact[3]]);sampleActivePlanet(true);
  view.update(solver.state,0,environment);discover();inventoryUpdate();message('충돌 지점에 운철 36kg이 남았습니다. 회수 도구로 모으세요.');
 }finally{operation=false;}void autosave();
}
async function newWorld(distance:number,gravity:number,gas:GasMaterial|'none',gasAmount:number,name:string) {
  if(operation||planets.length>=PLANET_LIMIT)return;operation=true;pointer.down=false;
  const first=awaitingCreation;
  try{
    await currentStep;if(!awaitingCreation)stashCurrent(true);
    view.leaveSystem();overview=false;el('system-labels').hidden=true;document.querySelector('.app')!.classList.remove('system-view');el('system-dialog').hidden=true;view.clearGrains();commands.fill(0);el('overview-open').setAttribute('aria-pressed','false');primary=placementPrimary;environment={...orbitalEnvironment(distance,gravity),climate:true,orbitAngle:(planets.length*2.399963229728653)%(Math.PI*2)};solver.replace(seedPlanet(grid,primary,environment.ambient,gas,gasAmount));solver.climate.restore();if(el<HTMLInputElement>('placement-life').checked){solver.climate.seedLife(solver.state);for(let i=0;i<grid.count;i++)solver.state[i*STRIDE+F.carbonDioxide]+=.003;solver.replace(solver.state);}view.setClimate(climateLayer,solver.climate);
    simTime=0;supplied=0;removed=0;escaped=0;transferredIn=0;transferredOut=0;spinAngle=0;axisTilt=23.5;spinPeriod=120;spinning=true;tidallyLocked=false;paused=false;
    oldTotals=totals(solver.state);activeId='planet-'+crypto.randomUUID();
    planets.push({id:activeId,name,snapshot:capture()});
    awaitingCreation=false;el<HTMLDialogElement>('placement').close();refreshWorld();el<HTMLButtonElement>('first-steps-open').disabled=false;if(first)firstSteps.open();else message('새 행성을 만들었습니다.');
  }finally{operation=false;}void autosave();
}
function resupply(){
 if(operation||mode==='sandbox')return;
 const system=captureSystem(),sums=system.planets.map(p=>totals(new Float32Array(p.snapshot.state)));let grants=0;
 for(const [id,amount,unlocked] of [['plant',8,true],['herbivore',4,progress.completed.includes('garden')],['carnivore',1,progress.completed.includes('grazer')]] as const){
  const existing=system.stock[id]+sums.reduce((n,t)=>n+t[F[id]],0);
  if(unlocked&&existing<.01){stock[id]+=amount;grants++;}
 }
 inventoryUpdate();message(grants?'소진된 생물 표본을 다시 보급했습니다.':'보관함이나 행성에 표본이 남아 있습니다. 회수해서 사용할 수 있어요.');void autosave();
}
function inventoryUpdate(){
 inventory?.update(stock,discoveries,mode);
 for(const m of MATERIALS){
  const button=document.querySelector<HTMLButtonElement>('[data-material="'+m.id+'"]')!,supply=button.querySelector<HTMLElement>('[data-supply]');
  if(isProduct(m.id)){
   if(mode==='sandbox'){button.disabled=false;if(supply){supply.textContent='∞';supply.setAttribute('aria-label','무제한');supply.classList.add('supply-unlimited');}button.title=currentLocale()==='en'?`${translatePhrase(m.note)} ${translatePhrase('샌드박스에서는 무제한으로 공급합니다.')}`:m.note+' 샌드박스에서는 무제한으로 공급합니다.';continue;}
   const known=discoveries.has(m.id)||stock[m.id]>0;button.disabled=stock[m.id]<.00001;
   if(supply){supply.textContent=stock[m.id].toFixed(1)+' kg';supply.removeAttribute('aria-label');supply.classList.remove('supply-unlimited');}
   const note=currentLocale()==='en'?translatePhrase(m.note):m.note;
   const suffix=known?(stock[m.id]>0?'공유 보관함에서 공급':'표면의 생성물을 회수해 보관함에 담으세요.'):'행성에서 생성하면 발견됩니다.';
   button.title=currentLocale()==='en'?`${note} ${translatePhrase(suffix)}`:`${note} ${suffix}`;
  }
 }
}
async function openSystem(){
 if(operation||!planets.length)return;if(overview){void switchPlanet(activeId);return;}
 observation.selecting=false;observationUiUpdate();
 pointer.down=false;setPlanetSettings(false);inventory.close();stashCurrent();renderSystemUi(planets,activeId,stock,mode);el<HTMLButtonElement>('system-add').disabled=planets.length>=PLANET_LIMIT;el('system-add').title=planets.length>=PLANET_LIMIT?'행성은 최대 '+PLANET_LIMIT+'개까지 만들 수 있습니다.':'새 행성 만들기';
 overview=true;el('system-labels').hidden=false;el('system-labels').replaceChildren();for(const p of planets){const b=document.createElement('button');b.translate=false;b.textContent=p.name;b.dataset.scenePlanet=p.id;b.addEventListener('click',()=>void switchPlanet(p.id));el('system-labels').append(b);}
 el('system-dialog').hidden=false;document.querySelector('.app')!.classList.add('system-view');el('overview-open').setAttribute('aria-pressed','true');
 await view.showSystem(planets,activeId);
  cameraViewUpdate();
}
function placementUpdate() {
  const distance=Number(el<HTMLInputElement>('placement-distance').value),e=orbitalEnvironment(distance);
  el('placement-distance-value').textContent=distance.toFixed(2)+' AU';el('placement-energy').textContent=e.sunlight.toFixed(2)+'×';el('placement-temperature').textContent=e.ambient.toFixed(0)+'°C';el('placement-period').textContent=formatPlanetDuration(orbitalPeriod(distance));
  el('placement-planet').style.left=(20+(distance-.65)/1.75*70)+'%';
  el('placement-gravity-value').textContent=Number(el<HTMLInputElement>('placement-gravity').value).toFixed(2)+'×';
  el('placement-gas-value').textContent=Number(el<HTMLInputElement>('placement-gas-amount').value).toFixed(1)+'×';
  el<HTMLInputElement>('placement-gas-amount').disabled=el<HTMLSelectElement>('placement-gas').value==='none';
  for(const id of ['placement-distance','placement-gravity','placement-gas-amount'])updateRangeControl(el<HTMLInputElement>(id));
  document.querySelectorAll<HTMLButtonElement>('[data-primary]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.primary===placementPrimary)));
}
function openPlacement(first=false) {if(planets.length>=PLANET_LIMIT){openSystem();message('네 행성을 함께 실험할 수 있어요.');return;}placementPrimary=first?'rock':primary;el<HTMLInputElement>('placement-name').value='행성 '+String(planets.length+1).padStart(2,'0');el<HTMLInputElement>('placement-name').setCustomValidity('');if(first){el<HTMLInputElement>('placement-distance').value='1';el<HTMLInputElement>('placement-gravity').value='1';el<HTMLSelectElement>('placement-gas').value='nitrogen';el<HTMLInputElement>('placement-gas-amount').value='1';el<HTMLInputElement>('placement-life').checked=false;}placementUpdate();el('placement-replace').hidden=first;el('placement').classList.toggle('first-choice',first);el('first-experiment').hidden=!first;el('placement').querySelector<HTMLElement>('.dialog-close')!.hidden=first;el<HTMLDialogElement>('placement').showModal();}
function rateUpdate(){const en=currentLocale()==='en';el('rate-value').textContent=paused?(Number(rateInput.value)*PHYSICS_DT).toFixed(2)+(en?' kg/step':' kg/번'):rateInput.value+(en?' kg/planet min':' kg/행성분');el('pour-rate-label').textContent=paused?(en?'Amount per step':'한 번에 붓는 양'):(en?'Pour rate':'흐르는 양');}
function pauseToggle() {paused=!paused;clock.reset();actualGameRate.reset();latestActualRate=null;el('game-rate').textContent=currentLocale()==='en'?(paused?'Paused':'Measuring actual speed'):(paused?'일시정지':'실제 측정 중');updateSpeedContext();if(paused)pointer.down=false;rateUpdate();el('pause').innerHTML=icon(paused?'play':'pause');el('pause').setAttribute('aria-label',currentLocale()==='en'?(paused?'Resume simulation':'Pause simulation'):(paused?'시뮬레이션 재생':'일시 정지'));el('pause').setAttribute('aria-pressed',String(paused));planetNavigationUpdate();el<HTMLButtonElement>('single-step').disabled=!paused;}
function cameraViewUpdate(){
  selectionControls?.refresh();
  const section=view.isSection;
  el<HTMLButtonElement>('axis-align').disabled=section;
  el('axis-align').title=currentLocale()==='en'?(section?'Align rotation axis · available in Globe view':'Align rotation axis · adjust the current view once'):(section?'자전축 정렬 · 구면 화면에서 사용':'자전축으로 정렬 · 현재 시점에서 한 번 맞추기');
  for(const [id,value] of [['section-angle',view.sectionAngle],['section-tilt',view.sectionTilt]] as const){el<HTMLInputElement>(id).value=String(value);el(id+'-value').textContent=Math.round(value)+'°';updateRangeControl(el<HTMLInputElement>(id));}
  el<HTMLSelectElement>('section-magnification').value=String(view.sectionMagnification);el('section-controls').hidden=!section;el<HTMLInputElement>('section-range').value=String(view.sectionRange);el('section-range-value').textContent=view.sectionSelection.a?view.sectionSelection.cells.length+'셀':'약 '+view.sectionRange+'셀';updateRangeControl(el<HTMLInputElement>('section-range'));
  document.querySelectorAll<HTMLButtonElement>('[data-section-navigation]').forEach(b=>b.setAttribute('aria-pressed',String(tool==='observe'&&!observation.selecting&&b.dataset.sectionNavigation===view.sectionNavigation)));
  el('section-tilt').toggleAttribute('disabled',!section);
  el('rotation-stick').setAttribute('aria-label',currentLocale()==='en'?(section?(view.sectionNavigation==='rotate'?'Section rotation joystick':'Section pan joystick'):'View rotation joystick'):(section?(view.sectionNavigation==='rotate'?'절단면 회전 조이스틱':'단면 이동 조이스틱'):'시점 회전 조이스틱'));
  el('rotation-stick-help').textContent=currentLocale()==='en'?(section?`Drag or use the arrow keys to steer. ${view.sectionNavigation==='rotate'?'Rotate the section along two axes.':'Pan the section view.'} Release to stop.`:'Drag in a direction to rotate; farther drags move faster. Release to stop. Arrow keys also work.'):(section?`원하는 방향으로 드래그하거나 방향키를 누르세요. ${view.sectionNavigation==='rotate'?'절단면을 두 축으로 돌립니다.':'단면 화면을 옮깁니다.'} 놓으면 멈춥니다.`:'원하는 방향으로 드래그하세요. 멀리 당길수록 빠르게 회전하고 놓으면 멈춥니다. 방향키로도 조작할 수 있습니다.');
  document.querySelector<HTMLButtonElement>('[data-mode="grab"]')!.title=currentLocale()==='en'?(section?(view.sectionNavigation==='rotate'?'Grab · drag to rotate section':'Grab · drag to pan section'):'Grab · drag to rotate view'):(section?(view.sectionNavigation==='rotate'?'그랩 · 드래그로 절단면 회전':'그랩 · 드래그로 단면 이동'):'그랩 · 드래그로 시점 회전');
  document.querySelectorAll<HTMLButtonElement>('[data-camera-view]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.cameraView==='section')===section)));
  el('section-angle').toggleAttribute('disabled',!section);el('section-width').toggleAttribute('disabled',!section);
  if(tool==='observe')el('scene-caption').textContent=currentLocale()==='en'?(section?(view.sectionNavigation==='rotate'?'Drag · rotate section':'Drag · pan section'):'Drag · rotate view'):(section?(view.sectionNavigation==='rotate'?'드래그 · 절단면 회전':'드래그 · 단면 이동'):'드래그 · 시점 회전');
  view.canvas.setAttribute('aria-label',currentLocale()==='en'?(section?`Planet section. Select a material to pour onto the surface or into empty space. In Grab mode or with right-drag, ${view.sectionNavigation==='rotate'?'rotate the section':'pan the view'}. Use the Move control or Shift-drag to pan. Scroll to zoom. Nearby cells are spread horizontally; bedrock is hidden.`:'Planet. In Grab mode or with right-drag, rotate; scroll to zoom. Select a material and left-drag to pour.'):(section?`행성 단면. 재료를 선택해 물질이나 빈 공간에 붓기. 그랩 또는 오른쪽 드래그로 ${view.sectionNavigation==='rotate'?'절단면 회전':'화면 이동'}. 이동 버튼 또는 Shift 드래그로 화면 이동. 휠로 확대. 선택 지점 주변의 셀을 가로로 펼쳐 표시하며 기반암은 숨깁니다.`:'행성. 그랩 또는 오른쪽 드래그로 회전, 휠로 확대. 재료를 선택해 왼쪽 드래그로 붓기.'));
}
function sceneLayerLegendUpdate(atmosphere=atmosphereState(solver.state,environment,solver.climate),cloudMass?:number){
  if(cloudMass===undefined){cloudMass=0;for(let p=0;p<solver.state.length;p+=STRIDE)cloudMass+=solver.state[p+F.cloud]+solver.state[p+F.cloudIce];}
  const dominant=[...atmosphere.species].sort((a,b)=>b.fraction-a.fraction)[0];
  const precipitation=view?.precipitationStats();
  updateSceneLayerLegend({
    atmosphere:{enabled:showAtmosphere,color:atmosphereOptics(atmosphere,environment).color,summary:atmosphere.mass>.01?GASES.find(g=>g.id===dominant.id)!.name+' '+(dominant.fraction*100).toFixed(0)+'%':'현재 대기 없음'},
    clouds:{enabled:showClouds,mass:cloudMass},
    precipitation:{enabled:showPrecipitation,rainCells:precipitation?.rainCells??0,snowCells:precipitation?.snowCells??0,paused},
  });
}
function appearanceUpdate() {
  document.documentElement.dataset.theme='dark';view?.setSpace();
  view?.setRenderSpinFrozen(renderSpinFrozen);spinUpdate();view?.setAxisVisible(showAxis);el('layer-axis').setAttribute('aria-pressed',String(showAxis));
  view?.setLayers(showAtmosphere,showClouds);view?.setPrecipitationLayer(showPrecipitation);el('layer-precipitation').setAttribute('aria-pressed',String(showPrecipitation));document.querySelector('.view')!.setAttribute('data-precipitation',String(showPrecipitation));el('precipitation-legend').hidden=!showPrecipitation;el('layer-atmosphere').setAttribute('aria-pressed',String(showAtmosphere));el('layer-clouds').setAttribute('aria-pressed',String(showClouds));
  sceneLayerLegendUpdate();
  settingsUiUpdate();
  saveAppearance();
}
function observationUiUpdate(){
  view?.orbitMode(overview||tool==='observe'&&!observation.selecting);
  el('observation-pin').setAttribute('aria-pressed',String(observation.selecting));
  el('observation-pin').title=observation.pinned?'핀 · 표면을 눌러 관찰 지점 옮기기':'핀 · 표면을 눌러 관찰 지점 고정';
  document.querySelector('[data-mode=grab]')!.setAttribute('aria-pressed',String(tool==='observe'&&!observation.selecting));
  el('material-mode').setAttribute('aria-pressed',String(tool!=='observe'&&!observation.selecting));
  el('observation-instruction').hidden=!observation.selecting;
  el('scene-caption').hidden=observation.selecting;
  el('observation-heading').textContent=observation.pinned?'고정한 지점':'지금 이 지점';
  el('observation-status').hidden=!observation.pinned;
  el('planet').classList.toggle('selecting-observation',observation.selecting);
  hideBrush();
  if(!observation.pinned)el('observation-marker').hidden=true;
}
function toggleObservationSelection(){
  const selecting=!observation.selecting;setTool('observe');observation.selecting=selecting;view.orbitMode(!selecting);observationUiUpdate();
}
function pinObservationAt(x:number,y:number){
  if(operation||overview)return;const rect=view.canvas.getBoundingClientRect(),hit=view.pick(x-rect.left,y-rect.top);
  if(!hit||hit.inAir)return;observation.pin(hit.index);observation.selecting=true;view.orbitMode(false);observationUiUpdate();observerUpdate();
}
function updateObservationMarker(){
  const solar=el('solar-position');solar.hidden=overview||operation;
  if(!solar.hidden){const position=view.sunPosition();solar.hidden=position.onScreen;solar.style.left=position.x+'px';solar.style.top=position.y+'px';}
  const marker=el('observation-marker');
  if(!observation.pinned||overview||operation){marker.hidden=true;return;}
  const point=view.observationPosition(observation.cell);marker.hidden=false;
  marker.style.left=point.x+'px';marker.style.top=point.y+'px';
  marker.dataset.offscreen=String(!point.visible);el('observation-marker-location').hidden=point.visible;marker.style.setProperty('--pin-direction',point.angle+'deg');
  marker.dataset.bottom=String(point.y>view.canvas.clientHeight-64);
  const location=point.behindSurface?'반대편':'화면 밖';
  el('observation-marker-location').textContent=location;
  const focus=el<HTMLButtonElement>('observation-focus');focus.disabled=point.visible;focus.setAttribute('aria-label',point.visible?'고정된 관찰 지점':'관찰 핀 · '+location+' · 이 지점으로 시점 이동');
  marker.title=point.visible?'고정된 관찰 지점':'클릭하면 핀 방향으로 시점이 이동합니다.';
  el('observation-status').textContent=point.visible?'핀으로 고정한 지점을 관측 중':'핀으로 고정한 지점 · '+location+' (가장자리에 방향 표시)';
  el('observation-status').dataset.shortLabel=point.visible?'핀 고정':'핀 고정 · '+location;
}
function setupInteractions() {
  firstSteps=new FirstSteps(()=>setMaterial('sand'));
  planetNavigation=new PlanetNavigation(()=>planets,()=>activeId,()=>operation||awaitingCreation,switchPlanet,renamePlanet);
  el<HTMLButtonElement>('dashboard-open').disabled=!planets.length;
  dashboard=new PlanetDashboard(telemetry,async()=>{await currentStep;sampleActivePlanet(true);for(const p of planets){if(p.id===activeId)continue;const s=p.snapshot;telemetry.sample(p.id,p.name,{...s,state:new Float32Array(s.state),escaped:s.escaped??0,transferredIn:s.transferredIn??0,transferredOut:s.transferredOut??0},true);}},()=>activeId,async(id,text)=>{parseTelemetryCsv(text);await saveSnapshot(capturePersistedSystem(),systemSlot+'-before-telemetry-import');await currentStep;sampleActivePlanet(true);const record=telemetry.planets.get(id);if(!record)throw new Error('선택한 행성의 관측 기록이 없습니다.');telemetry.planets.set(id,prependTelemetryCsv(record,text));await autosave();});
  activity=new ActivityCenter(id=>{
    if(!RESEARCH.some(r=>r.id===id))return;
    observerUpdate();el('research-open').focus();el<HTMLDialogElement>('research').showModal();document.querySelector('[data-discovery="'+id+'"]')!.scrollIntoView({block:'center'});
  },(cloud?'sandsphere-activity-'+slot:testing?'sandsphere-activity-test':'sandsphere-activity')+(mode==='sandbox'?'-sandbox':''));
  activity.seedDiscoveries([...discoveries].filter(id=>RESEARCH.some(r=>r.id===id)).map(discoveryNotice));
  if(telemetryRecoveryNotice)activity.add({kind:'error',title:'일부 대시보드 기록을 불러오지 못했습니다.',detail:'읽지 못한 원본은 복구용 저장본으로 보존했습니다. 행성 데이터는 정상적으로 불러왔습니다.',glyph:'chart'});
  activity.setEmphasis(emphasizeNotifications);
  el('settings-open').addEventListener('click',()=>{settingsUiUpdate();el<HTMLButtonElement>('first-steps-open').disabled=!planets.length;el<HTMLDialogElement>('app-settings').showModal();});
  el('first-steps-open').addEventListener('click',()=>{el<HTMLDialogElement>('app-settings').close();if(planets.length)firstSteps.open();});
  el('game-mode-open').addEventListener('click',()=>el<HTMLDialogElement>('game-mode').showModal());
  el('entry-login').addEventListener('click',()=>accountPanel?.open(el('entry-login')));
  el('entry-guest').addEventListener('click',()=>{el('entry-account-choice').hidden=true;el('entry-mode-choice').hidden=false;el('entry-mode-title').hidden=false;document.querySelector<HTMLButtonElement>('[data-game-mode="campaign"]')!.focus();});
  document.querySelectorAll<HTMLButtonElement>('[data-game-mode]').forEach(button=>button.addEventListener('click',()=>void selectGameMode(button.dataset.gameMode as GameMode)));
  el('game-mode').addEventListener('cancel',event=>{if(modeSelectionRequired)event.preventDefault();});
  el('first-experiment-customize').addEventListener('click',()=>{el('placement').classList.remove('first-choice');el('first-experiment').hidden=true;el<HTMLInputElement>('placement-name').focus();});
  el('first-experiment-create').addEventListener('click',()=>{void newWorld(1,1,'nitrogen',1,el<HTMLInputElement>('placement-name').value.trim()||'행성 01');});
  el('settings-notice-emphasis').addEventListener('change',()=>{emphasizeNotifications=el<HTMLInputElement>('settings-notice-emphasis').checked;activity!.setEmphasis(emphasizeNotifications);saveAppearance();});
  el('app-settings').addEventListener('close',()=>el('settings-open').focus());
  el('help').addEventListener('close',()=>el('settings-open').focus());
  setupHelpTips();
  setupRangeControls();
  for(const m of MATERIALS){const note=currentLocale()==='en'?translatePhrase(m.note):m.note;const suffix='선택하면 붓기, 다시 누르면 해제합니다.';document.querySelector<HTMLButtonElement>('[data-material="'+m.id+'"]')!.title=currentLocale()==='en'?`${note} ${translatePhrase(suffix)}`:`${note} ${suffix}`;}
  const toolTips={heat:'850°C 이상에서 점토가 소성됩니다.',cool:'염수는 담수보다 더 차가워야 얼어요.',erase:'표면의 물질을 조금씩 제거합니다.',collect:'회수한 물질은 모든 행성에서 함께 쓸 수 있어요.',meteor:'운철 36kg이 들어오고, 충돌 지형과 열이 남습니다.'};
  for(const [id,text] of Object.entries(toolTips))document.querySelector<HTMLButtonElement>('[data-tool="'+id+'"]')!.title=text;
  const canvas=view.canvas,touches=new Map<number,{x:number;y:number}>();let pinGesture:{id:number;x:number;y:number;valid:boolean}|null=null;let gesturing=false,lastTouch:{x:number;y:number;distance:number}|null=null;
  let pausedStrokePoint:{x:number;y:number}|null=null,pendingTouch:number|null=null,pausedTouchEdited=false;
  const touchMetrics=()=>{const points=[...touches.values()];return {x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2,distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)};};
  const moveTouchCamera=(dx:number,dy:number)=>{if(view.isSection&&view.sectionNavigation==='pan')view.panSectionPixels(dx,dy);else view.turn(-dx/220,-dy/220);};
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  canvas.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch'&&touches.has(event.pointerId)){
      const previous=touches.get(event.pointerId);
      touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(touches.size>=2){
        const m=touchMetrics();
        if(lastTouch){
          moveTouchCamera(m.x-lastTouch.x,m.y-lastTouch.y);
          if(m.distance>10&&lastTouch.distance>10)view.zoom(lastTouch.distance/m.distance);
        }
        lastTouch=m;pointer.down=false;hideBrush();return;
      }
      // Once navigation starts, every contact must end before editing can resume.
      if(gesturing)return;
      if(previous&&(overview||tool==='observe'&&!observation.selecting)){
        moveTouchCamera(event.clientX-previous.x,event.clientY-previous.y);
        hideBrush();return;
      }
    }
    pointer.x=event.clientX;pointer.y=event.clientY;
    if(paused&&pointer.down&&!gesturing&&event.buttons===1&&!event.shiftKey&&performance.now()>=touchPaintReadyAt){
      const spacing=Math.max(4,view.brushPixels(cellBrushAngle(grid,brushCell??0,Number(radiusInput.value)))*.25);
      if(!pausedStrokePoint||Math.hypot(pointer.x-pausedStrokePoint.x,pointer.y-pausedStrokePoint.y)>=spacing){paint(PHYSICS_DT);pausedTouchEdited=true;pausedStrokePoint={x:pointer.x,y:pointer.y};}
    }
    if(pinGesture&&Math.hypot(event.clientX-pinGesture.x,event.clientY-pinGesture.y)>8)pinGesture.valid=false;
    if(event.buttons===2||event.shiftKey||gesturing||event.buttons!==0&&tool==='observe'&&!observation.selecting){hideBrush();return;}
    // High-rate pointer events only update coordinates. Pick the latest position
    // once in the render loop; paint shares its own hit with the brush display.
    brushRefreshPending=true;
  });
  canvas.addEventListener('pointerdown',event=>{
    if(event.pointerType==='touch'){touchPaintReadyAt=performance.now()+120;touches.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);if(touches.size>=2){pendingTouch=null;pinGesture=null;gesturing=true;lastTouch=touchMetrics();pointer.down=false;hideBrush();return;}if(gesturing)return;}
    if(overview||view.isSelectingSection)return;
    if(event.button!==0||event.shiftKey)return;
    if(observation.selecting){pinGesture={id:event.pointerId,x:event.clientX,y:event.clientY,valid:true};canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});return;}
    pointer={x:event.clientX,y:event.clientY,down:tool!=='observe'};canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});
    pausedStrokePoint={x:pointer.x,y:pointer.y};pausedTouchEdited=false;
    if(pointer.down){if(event.pointerType==='touch')pendingTouch=event.pointerId;else if(paused||tool==='meteor')paint(PHYSICS_DT);}
  });
  const release=(event:PointerEvent)=>{pointer.down=false;pausedStrokePoint=null;pendingTouch=null;touches.delete(event.pointerId);lastTouch=touches.size>=2?touchMetrics():null;if(touches.size===0){gesturing=false;lastTouch=null;touchPaintReadyAt=0;}if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
  canvas.addEventListener('click',event=>{if(overview){const r=canvas.getBoundingClientRect(),id=view.pickPlanet(event.clientX-r.x,event.clientY-r.y);if(id)void switchPlanet(id);}});
  canvas.addEventListener('pointerup',event=>{if(pendingTouch===event.pointerId&&!gesturing&&pointer.down&&(tool==='meteor'||paused&&!pausedTouchEdited||!paused&&performance.now()<touchPaintReadyAt)){pointer.x=event.clientX;pointer.y=event.clientY;touchPaintReadyAt=0;paint(PHYSICS_DT);}if(pinGesture?.id===event.pointerId){const gesture=pinGesture;pinGesture=null;if(gesture.valid&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<=8&&observation.selecting&&!gesturing)pinObservationAt(event.clientX,event.clientY);}release(event);});canvas.addEventListener('pointercancel',event=>{pinGesture=null;release(event);});canvas.addEventListener('lostpointercapture',event=>{pinGesture=null;release(event);});
  canvas.addEventListener('pointerleave',()=>{hideBrush();});
  el('observation-pin').addEventListener('click',toggleObservationSelection);
  const pinMarker=el('observation-marker');
  pinMarker.addEventListener('pointerenter',()=>{pointer.down=false;hideBrush();});
  pinMarker.addEventListener('pointerdown',event=>event.stopPropagation());
  pinMarker.addEventListener('click',event=>{
    if((event.target as Element).closest('#observation-clear')||!observation.pinned||overview||operation||pinMarker.dataset.offscreen!=='true')return;
    pointer.down=false;view.focusObservation(observation.cell);cameraViewUpdate();
  });
  el('observation-clear').addEventListener('click',event=>{event.stopPropagation();const selecting=observation.selecting;observation.clear();observation.selecting=selecting;observationUiUpdate();observerUpdate();});
  el('material-mode').addEventListener('click',()=>{if(tool==='pour')setTool('observe');else setMaterial(material);});
  document.querySelectorAll<HTMLButtonElement>('[data-material]').forEach(b=>b.addEventListener('click',()=>{if(tool==='pour'&&material===b.dataset.material)setTool('observe');else setMaterial(b.dataset.material as Material);}));
  document.querySelectorAll<HTMLButtonElement>('button[data-category]').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.category!=='crafted'){setMaterial(b.dataset.category==='gas'?'nitrogen':'sand');return;}
    document.querySelectorAll<HTMLButtonElement>('button[data-category]').forEach(tab=>tab.setAttribute('aria-pressed',String(tab===b)));
    document.querySelector<HTMLElement>('.material-list')!.dataset.category='crafted';
    document.querySelectorAll<HTMLButtonElement>('[data-material]').forEach(button=>button.hidden=button.dataset.materialCategory!=='crafted');
      inventoryUpdate();
  }));
  document.querySelectorAll<HTMLButtonElement>('button[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(tool===b.dataset.tool?'observe':b.dataset.tool as Tool)));
  rotationStick=new RotationStick(el<HTMLButtonElement>('rotation-stick'),(x,y)=>view.turn(x,y));
  for(const id of ['placement-distance','placement-gravity','placement-gas-amount'])el<HTMLInputElement>(id).addEventListener('input',placementUpdate);
  el('placement-gas').addEventListener('change',placementUpdate);
  document.querySelectorAll<HTMLButtonElement>('[data-primary]').forEach(b=>b.addEventListener('click',()=>{placementPrimary=b.dataset.primary as PlanetMaterial;placementUpdate();}));
  document.querySelectorAll<HTMLButtonElement>('[data-distance]').forEach(b=>b.addEventListener('click',()=>{el<HTMLInputElement>('placement-distance').value=b.dataset.distance!;placementUpdate();}));
  el<HTMLInputElement>('placement-name').addEventListener('input',()=>el<HTMLInputElement>('placement-name').setCustomValidity(''));
  el('create-planet').addEventListener('click',()=>{const input=el<HTMLInputElement>('placement-name'),name=input.value.trim();input.setCustomValidity(name?'':translatePhrase('행성 이름을 입력하세요.'));if(!input.reportValidity())return;void newWorld(Number(el<HTMLInputElement>('placement-distance').value),Number(el<HTMLInputElement>('placement-gravity').value),el<HTMLSelectElement>('placement-gas').value as GasMaterial|'none',Number(el<HTMLInputElement>('placement-gas-amount').value),name);});
  radiusInput.addEventListener('input',()=>{brushSizeUpdate();if(brushHover)refreshBrush();});rateInput.addEventListener('input',rateUpdate);
  el<HTMLInputElement>('target').addEventListener('input',()=>el('target-value').textContent=el<HTMLInputElement>('target').value+'°C');
  el<HTMLInputElement>('axis-tilt').addEventListener('input',()=>{el('axis-number').removeAttribute('aria-invalid');el('axis-error').hidden=true;tidallyLocked=false;axisTilt=Number(el<HTMLInputElement>('axis-tilt').value);updateSun();spinUpdate();});
  const periodSlider=el<HTMLInputElement>('spin-period');let draggingPeriod=false;
  periodSlider.addEventListener('pointerdown',event=>{draggingPeriod=true;periodSlider.setPointerCapture(event.pointerId);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])periodSlider.addEventListener(event,()=>draggingPeriod=false);
  periodSlider.addEventListener('input',()=>{el('period-number').removeAttribute('aria-invalid');el('period-error').hidden=true;const snap=draggingPeriod?6*(Number(periodSlider.max)-Number(periodSlider.min))/Math.max(1,periodSlider.clientWidth-RANGE_THUMB_SIZE):0;selectSpinPeriod(Number(periodSlider.value),snap);spinUpdate();});
  el('planet-settings-toggle').addEventListener('click',()=>setPlanetSettings(el('planet-settings').hasAttribute('hidden')));
  el('planet-settings-close').addEventListener('click',()=>setPlanetSettings(false,true));
  el('planet-settings').addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();setPlanetSettings(false,true);}});
  for(const [id,error,apply] of [
    ['axis-number','axis-error',(value:number)=>{axisTilt=value;}],
    ['period-number','period-error',(value:number)=>{selectSpinPeriod(value);}],
    ['spin-speed-number','spin-speed-error',(value:number)=>{selectSpinSpeed(value);}],
  ] as const){
    const input=el<HTMLInputElement>(id);
    let edited=false;
    const validate=()=>{if(id==='spin-speed-number')input.setCustomValidity(validSpinSpeed(input.valueAsNumber)?'':translatePhrase('0 또는 0.3~18 °/분으로 입력하세요.'));return Number.isFinite(input.valueAsNumber)&&input.checkValidity();};
    input.addEventListener('focus',()=>{edited=false;});
    input.addEventListener('input',()=>{
      edited=true;
      if(!validate())return;
      input.removeAttribute('aria-invalid');el(error).hidden=true;
      tidallyLocked=false;apply(input.valueAsNumber);spinUpdate();
    });
    const commit=()=>{
      if(!edited)return;
      const valid=validate();
      el(error).hidden=valid;
      if(!valid){input.setAttribute('aria-invalid','true');return;}
      edited=false;input.removeAttribute('aria-invalid');tidallyLocked=false;apply(input.valueAsNumber);spinUpdate();
    };
    input.addEventListener('change',commit);
    input.addEventListener('blur',commit);
  }
  el('zoom-in').addEventListener('click',()=>view.zoom(.88));el('zoom-out').addEventListener('click',()=>view.zoom(1.12));
  el('axis-align').addEventListener('click',()=>view.alignSpinAxis());
  el('layer-axis').addEventListener('click',()=>{showAxis=!showAxis;appearanceUpdate();});
  document.querySelectorAll<HTMLButtonElement>('[data-camera-view]').forEach(b=>b.addEventListener('click',()=>{if(overview||operation)return;pointer.down=false;hideBrush();if(b.dataset.cameraView==='section'){if(!view.isSection){setTool('observe');observation.selecting=false;observationUiUpdate();view.beginSectionSelection(view.sectionSelection.a?undefined:observation.pinned?observation.cell:undefined);}}else{view.cancelSectionSelection();view.setSection(false);}cameraViewUpdate();}));
  selectionControls=new SectionSelectionControls(view,view.canvas.parentElement!);
  view.onSectionChange=cameraViewUpdate;
  document.querySelectorAll<HTMLButtonElement>('[data-section-navigation]').forEach(b=>b.addEventListener('click',()=>{setTool('observe');view.setSectionNavigation(b.dataset.sectionNavigation as 'rotate'|'pan');}));
  document.querySelectorAll<HTMLButtonElement>('[data-section-framing]').forEach(b=>b.addEventListener('click',()=>view.frameSection(b.dataset.sectionFraming as 'surface'|'whole')));
  el<HTMLInputElement>('section-tilt').addEventListener('input',event=>view.setSectionTilt(Number((event.target as HTMLInputElement).value)));
  el<HTMLInputElement>('section-angle').addEventListener('input',event=>{const angle=Number((event.target as HTMLInputElement).value);view.setSectionAngle(angle);el('section-angle-value').textContent=angle+'°';});
  el<HTMLSelectElement>('section-magnification').addEventListener('change',event=>view.setSectionMagnification(Number((event.target as HTMLSelectElement).value)));
  el<HTMLInputElement>('section-range').addEventListener('input',event=>view.setSectionRange(Number((event.target as HTMLInputElement).value)));
  el<HTMLInputElement>('section-width').addEventListener('input',event=>{const width=Number((event.target as HTMLInputElement).value);view.setSectionWidth(width);el('section-width-value').textContent=width<.16?'좁게':width>.4?'넓게':'보통';});
  el('single-step').addEventListener('click',()=>{if(!paused||busy||operation||overview)return;busy=true;currentStep=tick(PHYSICS_DT).finally(()=>busy=false);});
  cameraViewUpdate();
  el('spin').addEventListener('click',()=>{renderSpinFrozen=!renderSpinFrozen;view.setRenderSpinFrozen(renderSpinFrozen);appearanceUpdate();});el('pause').addEventListener('click',pauseToggle);el('home').addEventListener('click',()=>overview?void switchPlanet(activeId):view.home());
  el('speed-decrease').addEventListener('click',()=>changeSpeed(-1));
  el('speed-increase').addEventListener('click',()=>changeSpeed(1));
  el('climate-legend-toggle').addEventListener('click',()=>{const open=el('climate-legend-toggle').getAttribute('aria-expanded')!=='true';el('climate-legend-toggle').setAttribute('aria-expanded',String(open));document.querySelector('.view')!.classList.toggle('climate-legend-open',open);});
  const selectClimate=(layer:ClimateLayer)=>{climateLayer=layer;updateClimatePicker(layer);view.setClimate(layer,solver.climate);updateClimateLegend(layer,grid.count);};
  setupClimatePicker(climateLayer,selectClimate);updateClimateLegend(climateLayer,grid.count);
  document.querySelectorAll<HTMLButtonElement>('[data-observe-climate]').forEach(button=>button.addEventListener('click',()=>selectClimate(button.dataset.observeClimate as ClimateLayer)));
  el('layer-precipitation').addEventListener('click',()=>{showPrecipitation=!showPrecipitation;appearanceUpdate();});
  el('layer-atmosphere').addEventListener('click',()=>{showAtmosphere=!showAtmosphere;appearanceUpdate();});el('layer-clouds').addEventListener('click',()=>{showClouds=!showClouds;appearanceUpdate();});
  el('overview-open').addEventListener('click',()=>void openSystem());el('system-return').addEventListener('click',()=>void switchPlanet(activeId));el('inventory-open').addEventListener('click',()=>inventory.open());
  el('system-dialog').addEventListener('click',event=>{const target=(event.target as Element).closest<HTMLElement>('[data-planet-id]');if(target)void switchPlanet(target.dataset.planetId!);});
  el('system-add').addEventListener('click',()=>openPlacement());
  el('system-rename').addEventListener('click',()=>planetNavigation?.openRename());

  el('research-open').addEventListener('click',()=>{observerUpdate();el<HTMLDialogElement>('research').showModal();});el('help-open').addEventListener('click',()=>{el<HTMLDialogElement>('app-settings').close();el<HTMLDialogElement>('help').showModal();});
  document.querySelectorAll<HTMLButtonElement>('.dialog-close').forEach(b=>b.addEventListener('click',()=>b.closest('dialog')!.close()));
  el('placement').addEventListener('cancel',e=>{if(awaitingCreation)e.preventDefault();});
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach(d=>d.addEventListener('click',e=>{if(d.id==='placement'&&awaitingCreation||d.id==='game-mode'&&modeSelectionRequired)return;if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  setupWorkbench();
  window.addEventListener('blur',()=>{pointer.down=false;touches.clear();gesturing=false;lastTouch=null;pendingTouch=null;pinGesture=null;touchPaintReadyAt=0;view.orbitMode(overview||tool==='observe'&&!observation.selecting);});document.addEventListener('visibilitychange',()=>{if(document.hidden){pointer.down=false;void autosave();}});
  window.addEventListener('pagehide',()=>{if(replacingSession||awaitingCreation||!planets.length)return;try{localStorage.setItem(systemResumeKey,JSON.stringify(capturePersistedSystem(true)));}catch(error){console.warn('Immediate resume checkpoint unavailable; the last automatic save is retained.',error);}});
  window.addEventListener('keydown',e=>{
    if(e.target instanceof HTMLInputElement||document.querySelector('dialog[open]'))return;
    if((e.ctrlKey||e.metaKey)&&e.code==='KeyS'){e.preventDefault();void autosave();return;}
    const materials:Record<string,Material>={Digit1:'sand',Digit2:'water',Digit3:'clay',Digit4:'salt'},tools:Record<string,Tool>={KeyG:'heat',KeyC:'cool',KeyX:'erase'};
    if(materials[e.code])setMaterial(materials[e.code]);if(tools[e.code])setTool(tools[e.code]);if(e.code==='Escape'){view.cancelSectionSelection();if(overview)void switchPlanet(activeId);inventory.close();setTool('observe');}
    if(e.code==='KeyP'&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!overview&&!operation){e.preventDefault();toggleObservationSelection();}
    if(e.code==='Space'&&!(e.target instanceof HTMLButtonElement)){e.preventDefault();if(!e.repeat)pauseToggle();}if(e.code==='KeyR'){if(overview)void switchPlanet(activeId);else view.home();}if(e.code.startsWith('Shift')){pointer.down=false;view.orbitMode(true);}
    if(document.activeElement===canvas){const turns:Record<string,number[]>={ArrowLeft:[-.08,0],ArrowRight:[.08,0],ArrowUp:[0,-.08],ArrowDown:[0,.08]};if(turns[e.code]){e.preventDefault();view.turn(turns[e.code][0],turns[e.code][1]);}if(e.code==='Enter'){const r=canvas.getBoundingClientRect();pointer.x=r.x+r.width/2;pointer.y=r.y+r.height/2;if(observation.selecting)pinObservationAt(pointer.x,pointer.y);else paint(paused?PHYSICS_DT:.1);}}
  });window.addEventListener('keyup',e=>{if(e.code.startsWith('Shift'))view.orbitMode(overview||tool==='observe'&&!observation.selecting);});
}
async function boot() {
  const services=testing?null:firebaseServices();
  if(services){await services.auth.authStateReady();const uid=services.auth.currentUser?.uid??null;({slot,discoveryKey,systemSlot,systemResumeKey,checkpointKey}=saveScope(uid));if(uid)cloud=new FirebaseSaveStore(services,uid,grid.count);
    onAuthStateChanged(services.auth,user=>{if((user?.uid??null)!==uid)void preserveAndReload();});}
  let firstWorld=true;
  const [diskSystem,diskTelemetryBase]=await Promise.all([loadRecord(systemSlot),loadRecord(systemSlot+'-telemetry-base')]);let localSystem:unknown;
  try{localSystem=JSON.parse(localStorage.getItem(systemResumeKey)??'null');}catch{}
  const validDisk=validSystem(diskSystem,grid.count)?diskSystem:null,validLocal=validSystem(localSystem,grid.count)?localSystem:null;
  let system=validLocal&&validLocal.savedAt>(validDisk?.savedAt??0)?validLocal:validDisk;
  if(!system&&!cloud){
    const emptyEnvelope=(value:unknown)=>!!value&&typeof value==='object'&&Array.isArray((value as SystemSave).planets)&&(value as SystemSave).planets.length===0;
    // Recover an interrupted development migration with no worlds. Preserve the
    // incomplete envelope separately; the untouched legacy save is the source.
    if(emptyEnvelope(diskSystem))await saveSnapshot(diskSystem,systemSlot+'-incomplete');
    if((diskSystem!==undefined&&!emptyEnvelope(diskSystem))||(localSystem&&!emptyEnvelope(localSystem)))throw new Error('저장된 항성계를 읽지 못했습니다. 기존 데이터는 보존됩니다.');
    const disk=await loadSnapshot(grid.count,slot);let local:Snapshot|null=null;
    try{const candidate=JSON.parse(localStorage.getItem(resumeKey)??'null');if(validSnapshot(candidate,grid.count))local=candidate;}catch{}
    const snapshot=local&&(local.savedAt??0)>(disk?.savedAt??0)?local:disk;
    if(snapshot)system=migrateWorld(snapshot,grid.count);
  }
  if(cloud){
    try{const raw=JSON.parse(localStorage.getItem(checkpointKey)??'null');if(raw&&(raw.revision===null||typeof raw.revision==='string')&&Number.isFinite(raw.syncedAt))checkpoint=raw;}catch{}
    try{remoteSave=await cloud.read();const decision=chooseSave(system,remoteSave,checkpoint);cloudReady=true;
      if(decision==='remote'){if(system)await saveSnapshot(system,systemSlot+'-before-cloud');system=remoteSave!.system;await saveSnapshot(system,systemSlot);localStorage.removeItem(systemResumeKey);setCheckpoint(remoteSave!.revision,system.savedAt);}
      cloudConflict=decision==='conflict';cloudMessage=cloudConflict?'서로 다른 진행 상황을 발견했습니다. 사용할 저장본을 선택하세요.':system?'계정 게임을 불러왔습니다.':'계정에 저장된 게임이 없습니다. 새 행성을 만들거나 비회원 게임을 가져오세요.';
    }catch(error){cloudMessage='클라우드에 연결하지 못했습니다. 이 기기의 저장본으로 진행하며 지금 저장에서 다시 시도할 수 있습니다.';console.warn('Cloud restore unavailable.',error);}
  }
  if(system){
    persistenceStamp=Math.max(persistenceStamp,system.savedAt);
    if(system.version===1)await saveSnapshot(system,systemSlot+'-v02-backup');
    mode=system.mode??'campaign';otherMode=system.other;loadDiscoveries();
    progress=system.progress??freshProgress();
    planets=system.planets;activeId=system.activeId;stock={...emptyStock(),...system.stock};if(system.version===1)stock.plant+=8;
    for(const planet of planets){planet.snapshot=upgradeSnapshot(planet.snapshot,grid.count);spherizeLegacyRockPlanet(planet.snapshot,grid);planet.snapshot.environment.climate=true;for(const id of planet.snapshot.discoveries)discoveries.add(id);}
    if(planets.length){
    const snapshot=planets.find(p=>p.id===activeId)!.snapshot;resume(snapshot);lastSaved=snapshot;firstWorld=false;
    const previousBase=diskTelemetryBase as {savedAt:number;archive:unknown}|undefined;
    const base=validDisk&&system.telemetry?.baseSavedAt===validDisk.savedAt?{savedAt:validDisk.savedAt,archive:validDisk.telemetry}:previousBase;
    const restored=restoreTelemetry(telemetry,system.telemetry,planets.map(p=>({id:p.id,name:p.name,time:p.snapshot.time})),base);
    if(restored.rejected){try{await saveSnapshot(system.telemetry,systemSlot+'-telemetry-recovery');telemetryRecoveryNotice=true;}catch(error){console.warn('Analytics recovery backup unavailable.',error);}}
    if(fullTelemetryArchive(validDisk?.telemetry))savedTelemetry={savedAt:validDisk!.savedAt,archive:validDisk!.telemetry!};
    }
  }
  if(!system){stock.plant=8;loadDiscoveries();}
  inventory=new Inventory(setMaterial,stock,resupply);
  window.addEventListener('sandsphere-language-change',()=>{el('pause').setAttribute('aria-label',currentLocale()==='en'?(paused?'Resume simulation':'Pause simulation'):(paused?'시뮬레이션 재생':'일시 정지'));spinUpdate();brushSizeUpdate();for(const [id,message] of [['placement-name','행성 이름을 입력하세요.'],['spin-speed-number','0 또는 0.3~18 °/분으로 입력하세요.']]){const input=el<HTMLInputElement>(id);if(input.validity.customError)input.setCustomValidity(translatePhrase(message));}inventoryUpdate();updateMaterialModeTitle();updateSceneCaption();observerUpdate();updateSpeedContext();rateUpdate();cameraViewUpdate();planetNavigationUpdate();updateSystemUi(planets,stock,mode);dashboard?.render(true);sceneLayerLegendUpdate();updateClimateLegend(climateLayer,grid.count);});
  view=await PlanetView.create(el<HTMLCanvasElement>('planet'),grid,solver.state);
  view.setSurfaceStyle(true,1,true);
  view.setCloudStyle('stratus');view.setCloudAppearance(true,.84);
  const forceCpu=new URLSearchParams(location.search).get('cpu')==='1';
  let backgroundSolver:WorkerSolver|null=null;
  try{backgroundSolver=await WorkerSolver.create(grid,solver.state,forceCpu);}catch(error){console.warn('Background compute unavailable.',error);}
  if(backgroundSolver){backgroundSolver.climate.restoreCheckpoint(solver.climate.checkpoint());solver.dispose();solver=backgroundSolver;}
  else if(!forceCpu)try{const gpu=await GpuSolver.create(grid,solver.state);if(gpu){gpu.climate.restoreCheckpoint(solver.climate.checkpoint());solver.dispose();solver=gpu;}}catch(error){console.warn('GPU compute unavailable.',error);}
  el('backend').textContent=solver.backend;view.setClimate(climateLayer,solver.climate);setupInteractions();setupAccount(services);setTool('observe');renderDiscoveryRecords();environmentUpdate();spinUpdate();view.setTime(simTime);appearanceUpdate();view.home();modeUiUpdate();
  if(paused){paused=false;pauseToggle();}
  const hit=view.pick(view.canvas.clientWidth/2,view.canvas.clientHeight/2);observation.switchPlanet(activeId,hit?.index??0);observationUiUpdate();view.onReady(()=>el('boot').hidden=true);
  observerUpdate();awaitingCreation=firstWorld;if(firstWorld){if(system)openPlacement(true);else{modeSelectionRequired=true;el('game-mode').classList.add('first-entry');el('game-mode-title').textContent='첫 행성 만들기';el('first-entry-intro').hidden=false;const user=services?.auth.currentUser,signedIn=!!user;el('entry-account-choice').hidden=signedIn;el('entry-mode-choice').hidden=!signedIn;el('entry-mode-title').hidden=!signedIn;el('entry-signed-in').hidden=!signedIn;if(signedIn)el('entry-signed-in').textContent='로그인됨 · '+(user.email??'계정');if(!services){el<HTMLButtonElement>('entry-login').disabled=true;el('entry-account-copy').textContent='지금은 계정 연결을 사용할 수 없습니다. 게스트 게임은 이 브라우저에 저장됩니다.';}el('game-mode').querySelector<HTMLElement>('.dialog-close')!.hidden=true;el<HTMLDialogElement>('game-mode').showModal();}}else seedTelemetry();if(cloudConflict)accountPanel?.open();
  let previous=performance.now(),observerClock=0,frames=0,fpsClock=0,saveClock=0;
  // Hidden tabs suspend simulation; resuming must not enqueue the hidden interval.
  document.addEventListener('visibilitychange',()=>{previous=performance.now();clock.reset();actualGameRate.reset();latestActualRate=null;});
  const runSteps=async(count:number)=>{for(let n=0;n<count;n++){if(view.cameraDragging)break;if(!paused)await tick(PHYSICS_DT);else if(commands.some(v=>v!==0))await tick(0);await backgroundWorlds.stepAsync(planets,activeId,PHYSICS_DT,sampleBackgroundPlanet);}};
  view.engine.runRenderLoop(()=>{
    const now=performance.now(),realDt=(now-previous)/1000,dt=Math.min(.05,realDt);previous=now;
    if(!document.hidden){
      // Motion uses the live solver clock, independently of the slower surface/UI snapshots.
      if(overview){const active=planets.find(p=>p.id===activeId);if(active){active.snapshot.time=simTime;active.snapshot.environment={...environment};active.snapshot.paused=paused;active.snapshot.spin={angle:spinAngle,running:spinning,tilt:axisTilt,period:spinPeriod,locked:tidallyLocked};}}
      else view.setMotion({time:simTime,environment:{...environment},paused:paused||operation||el<HTMLDialogElement>('placement').open||view.cameraDragging,spin:{angle:spinAngle,running:spinning,tilt:axisTilt,period:spinPeriod,locked:tidallyLocked}});
      rotationStick.update(dt);view.animate(overview?Math.min(.25,realDt):dt,Math.min(speed,latestActualRate??1));
      if(!overview&&!busy&&!operation&&!view.cameraDragging){const refreshDt=surfaceRefresh.take(now);if(refreshDt!==null)view.update(solver.state,refreshDt,environment);}
      if(!operation&&!awaitingCreation&&!el<HTMLDialogElement>('placement').open&&!el<HTMLDialogElement>('game-mode').open&&!view.cameraDragging){clock.add(realDt,speed);if(!busy){const count=clock.take(environment.climate?1:4);if(count){busy=true;currentStep=runSteps(count).finally(()=>busy=false);}}}else clock.reset();
      if((brushHover||brushRefreshPending)&&now-lastBrushRefresh>=33){lastBrushRefresh=now;brushRefreshPending=false;const r=view.canvas.getBoundingClientRect(),hit=view.pick(pointer.x-r.left,pointer.y-r.top);showBrush(hit);if(hit&&!hit.inAir)observation.hover(hit.index);}
      view.scene.render();selectionControls?.update();updateObservationMarker();if(overview)for(const p of view.systemLabels()){const label=el('system-labels').querySelector<HTMLElement>('[data-scene-planet="'+p.id+'"]');if(label){label.style.left=p.x+'px';label.style.top=(p.y+35)+'px';label.hidden=p.z<0||p.z>1;}}observerClock+=dt;frames++;fpsClock+=realDt;saveClock+=realDt;
      if(observerClock>.2){observerClock=0;el('game-elapsed').textContent=formatPlanetElapsed(simTime);const running=!paused&&!operation&&!awaitingCreation&&!el<HTMLDialogElement>('placement').open&&!el<HTMLDialogElement>('game-mode').open&&!view.cameraDragging;const actual=actualGameRate.sample(now,simTime,activeId,running,speed===SIMULATION_SPEEDS[0]?12:3);latestActualRate=actual;updateSpeedContext();el('game-rate').textContent=running?(actual===null?(currentLocale()==='en'?'Measuring actual speed':'실제 측정 중'):(currentLocale()==='en'?'Actual ':'실제 ')+formatPlanetRate(actual)):currentLocale()==='en'?(view.cameraDragging?'Moving viewpoint':paused?'Paused':'Waiting to calculate'):(view.cameraDragging?'시점 이동 중':paused?'일시정지':'계산 대기');observerUpdate();if(!operation){const active=planets.find(p=>p.id===activeId);if(active)active.snapshot={...active.snapshot,time:simTime,environment:{...environment},paused,transferredIn,state:[...solver.state]};if(mode==='campaign'){const completed=advanceProgress(progress,planets,stock);if(completed.length){inventoryUpdate();message('탐사 완료 · '+completed.map(id=>EXPEDITIONS.find(m=>m.id===id)!.name).join(' · '));}updateExpeditions(progress);}}}if(fpsClock>=1){el('fps').textContent=Math.round(frames/fpsClock)+' fps';frames=0;fpsClock=0;}if(saveClock>=5){saveClock=0;void autosave();}
    }
  });
  if(import.meta.env.DEV)Object.assign(window,{sandsphere:{stats:()=>({climate:{maxWind:Math.max(...Array.from({length:grid.count},(_,i)=>Math.hypot(...solver.climate.wind.slice(i*3,i*3+3)))),maxCurrent:Math.max(...Array.from({length:grid.count},(_,i)=>Math.hypot(...solver.climate.currents.slice(i*3,i*3+3)))),seedCells:solver.climate.seeds.filter(v=>v>.001).length},backend:solver.backend,backgroundCompute:solver instanceof WorkerSolver,time:simTime,mass:totalMass(solver.state),enthalpy:totalEnthalpy(solver.state,solver.climate),lastStepEnergy:[0,1,2,3].map(k=>solver.energyChanges.reduce((sum,v,i)=>sum+(i%4===k?v:0),0)),impactEnergy:[...impactEnergy],inFlightMass:view.deposits().reduce((sum,g)=>sum+g.amount,0),totals:[...totals(solver.state)],supplied,removed,escaped,discoveries:[...discoveries],paused,tool,observation:{cell:observation.cell,pinned:observation.pinned,selecting:observation.selecting},camera:[view.camera.alpha,view.camera.beta,view.camera.radius],renderRotation:view.rotationStats(),spinAngle,spinning,axisTilt,spinPeriod,primary,sun:worldSun(),environment,atmosphere:atmosphereState(solver.state,environment,solver.climate),atmosphereOptics:atmosphereOptics(atmosphereState(solver.state,environment,solver.climate),environment),rainingCells:solver.precipitatedCells.filter((v,i)=>i%2===0&&v>1e-6).length,snowingCells:solver.precipitatedCells.filter((v,i)=>i%2===1&&v>1e-6).length,cloudCells:solver.state.filter((v,i)=>i%STRIDE===F.cloud&&v+solver.state[i+1]>CLOUD_VISIBLE_MASS).length,cloudMass:totals(solver.state)[F.cloud]+totals(solver.state)[F.cloudIce],effects:view.visualStats(),lastSavedAt:lastSaved?.savedAt??null,renderer:view.engine.constructor.name,stock:{...stock},transferredIn,transferredOut,activeId,planets:planets.map(p=>({id:p.id,name:p.name,time:p.id===activeId?simTime:p.snapshot.time,mass:p.id===activeId?totalMass(solver.state):totalMass(new Float32Array(p.snapshot.state)),paused:p.id===activeId?paused:p.snapshot.paused})),tidallyLocked,overview,progress}),state:()=>new Float32Array(solver.state),climate:()=>solver.climate.snapshot(),grid,
    compareGpu:async()=>{const state=seedWorld(grid);state[F.vapor]=3;state[STRIDE+F.cloud]=.8;state[2*STRIDE+F.cloudIce]=.6;const cpu=new CpuSolver(grid,new Float32Array(state)),gpu=await GpuSolver.create(grid,new Float32Array(state));if(!gpu)return {supported:false};const c=new Float32Array(grid.count*COMMAND_STRIDE);c[0]=30;c[3]=2;c[8]=10;c[9]=7;c[10]=12;c[12]=5;c[13]=8;c[14]=4;c[15]=30;c[16]=2;c[17]=.3;c[18]=.1;c[19]=5;c[6]=.15;const e={...environmentFor('coast'),gravity:.03};let cpuEscaped=0,gpuEscaped=0,cpuRain=0,gpuRain=0;for(let n=0;n<20;n++){const batch=n?new Float32Array(c.length):c;cpu.advance(.1,batch,e);await gpu.step(.1,batch,e);cpuEscaped+=cpu.escapeCells.reduce((s,v)=>s+v,0);gpuEscaped+=gpu.escapeCells.reduce((s,v)=>s+v,0);cpuRain+=cpu.precipitatedCells.reduce((s,v)=>s+v,0);gpuRain+=gpu.precipitatedCells.reduce((s,v)=>s+v,0);}let maxError=0;for(let i=0;i<state.length;i++)maxError=Math.max(maxError,Math.abs(cpu.state[i]-gpu.state[i]));const result={supported:true,maxError,cpuMass:totalMass(cpu.state),gpuMass:totalMass(gpu.state),cpuEscaped,gpuEscaped,cpuRain,gpuRain};gpu.dispose();return result;}}});
}
void boot().catch(error=>{console.error(error);el('boot').querySelector('strong')!.textContent='행성을 불러오지 못했어요.';el('boot-message').textContent=error instanceof Error?error.message:'저장 데이터와 그래픽 초기화를 확인해주세요.';});
