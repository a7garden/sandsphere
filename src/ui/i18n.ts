export type Locale = 'ko' | 'en';

const translations: Record<string, string> = {
  '설정': 'Settings', '설정 닫기': 'Close settings', '언어': 'Language', '한국어': '한국어', '영어': 'English',
  '알림': 'Notifications', '새 알림 강조': 'Highlight new notifications', '새 소식이 오면 알림 아이콘을 잠시 강조': 'Briefly highlight the notifications icon when something new arrives',
  '첫 실험 안내': 'First experiment', '조작 방법': 'Controls', '변경 사항은 바로 적용됩니다.': 'Changes take effect immediately.',
  '게임 모드': 'Game mode', '게임 모드 선택': 'Choose game mode', '현재 모드': 'Current mode',
  '플레이 모드': 'Game mode', '플레이 모드 선택': 'Choose game mode', '캠페인': 'Campaign', '샌드박스': 'Sandbox', '추천': 'Recommended',
  '행성 만들기': 'Create a planet', '첫 행성 만들기': 'Create your first planet', '로그인 또는 회원가입': 'Sign in or create an account', '게스트로 시작': 'Continue as guest',
  '어디에 저장할까요?': 'Where should your game be saved?', '로그인하면 계정에 게임을 저장하고 다른 기기에서 이어할 수 있어요. 게스트 게임은 이 브라우저에 저장됩니다.': 'Sign in to save your game to your account and continue on another device. Guest games are saved in this browser.',
  '게임 저장': 'Game saving', '로그인·회원가입': 'Sign in or create an account', '클라우드 저장 관리': 'Manage cloud saves',
  '이 브라우저에 자동 저장됩니다.': 'Your game is saved automatically in this browser.',
  '이 브라우저에 자동 저장됩니다. 로그인하면 다른 기기에서도 이어할 수 있어요.': 'Your game is saved automatically in this browser. Sign in to continue on another device.',
  '로그인한 계정에 자동 저장됩니다.': 'Your game is saved automatically to your signed-in account.',
  '로그인됨': 'Signed in', '계정과 저장': 'Account & Saves', '계정 창 닫기': 'Close account dialog', '저장': 'Save', '취소': 'Cancel', '닫기': 'Close', '완료': 'Done', '편집': 'Edit',
  '항성계': 'Star system', '발견 기록': 'Discovery log', '발견 기록 닫기': 'Close discovery log', '행성 대시보드': 'Planet dashboard', '알림 센터': 'Notifications', '도구 패널 접기': 'Collapse tools panel', '관측 패널 접기': 'Collapse observation panel',
  '실험실 메뉴': 'Workbench menu', '실험 도구': 'Tools', '인벤토리': 'Inventory', '물질 종류': 'Material categories', '표면 물질': 'Surface', '기체': 'Gases', '발견': 'Discovery',
  '가열': 'Heat', '냉각': 'Cool', '깎기': 'Erase', '회수': 'Collect', '운석': 'Meteor', '브러시 크기': 'Brush size', '흐르는 양': 'Pour rate', '목표 온도': 'Target temperature', '탐사 과제': 'Expeditions',
  '그랩': 'Grab', '관찰 핀': 'Observation pin', '재료 붓기': 'Pour material', '붓기': 'Pour', '모래를 부어보세요.': 'Try pouring some sand.', '태양 에너지': 'Solar energy', '지도와 표시 레이어': 'Map and display layers', '관찰 지도': 'Observation map', '물질': 'Material', '범례': 'Legend',
  '절단선 선택': 'Select a section', '양 끝 셀을 드래그해 범위를 선택하세요.': 'Drag the endpoint cells to select a range.', '선택한 단면 열기': 'Open selected section', '선택 재료': 'Selected material',
  '아직 알림이 없습니다.': 'No notifications yet.', '읽지 않은 알림이 없습니다.': 'No unread notifications.', '모두 읽음': 'Mark all as read', '전체': 'All', '읽지 않음': 'Unread', '읽음': 'Read', '읽음으로 표시': 'Mark as read', '발견 기록 보기 →': 'View discovery →', '이전 발견': 'Earlier discovery', '탐사 완료': 'Expedition complete', '실험': 'Experiment', '오류': 'Error',
  '무제한': 'Unlimited', '+ 추가': '+ Add', '빠른 선택에서 제외': 'Remove from quick selection', '빠른 선택에 추가': 'Add to quick selection', '소진된 생물 표본 다시 받기': 'Restock depleted life samples', '표시할 재료가 없습니다.': 'No materials to show.',
  '관측 정보': 'Observation information', '관측': 'Observation', '관측 범위': 'Observation scope', '지점': 'Point', '행성': 'Planet', '날씨': 'Weather', '지금 이 지점': 'Current location', '핀으로 고정한 지점을 관측 중': 'Observing the pinned location', '표면': 'Surface', '지표 온도': 'Surface temperature', '이 지점 열 교환': 'Heat exchange at this location', '열 모델': 'Thermal model', '현재 대기에서 지표 복사 평형': 'Surface radiative balance under current atmosphere', '외부 열 교환': 'External heat exchange', '도구·물질 공급': 'Tools and material input', '탈출 에너지': 'Escaped energy', '수치 보정': 'Numerical correction', '최근 기체 손실': 'Recent gas loss',
  '행성 대기': 'Planetary atmosphere', '대기': 'Atmosphere', '지표 기압': 'Surface pressure', '기체량': 'Gas mass', '기체 조성': 'Gas composition', '기체·중력 상세': 'Gas and gravity details', '대기 계산': 'Atmosphere model', '기체 온도': 'Gas temperature', '중력': 'Gravity', '외곽선 높이': 'Atmosphere height', '가장 약한 결합 λ': 'Weakest binding λ', '우주로 빠져나감': 'Lost to space', '행성 기본 정보': 'Planet properties', '궤도': 'Orbit', '주요 물질': 'Primary material',
  '행성의 날씨': 'Planetary weather', '날씨와 지도': 'Weather and maps', '물의 순환 관측 중': 'Observing the water cycle', '구름 물·얼음 합계': 'Cloud water and ice', '새로 응결': 'New condensation', '지표 도달 비': 'Rain reaching the surface', '지표 도달 눈': 'Snow reaching the surface', '구름량 지도': 'Cloud map', '습도 지도': 'Humidity map', '강수 지역 범례': 'Precipitation regions', '물의 순환': 'Water cycle', '이 지점 물 비등 기준': 'Boiling point at this location',
  '이 지점의 기후': 'Climate at this location', '지점 기후': 'Local climate', '이 지점 기압': 'Local pressure', '구름층 온도': 'Cloud-layer temperature', '구름층 습도': 'Cloud-layer humidity', '구름 물·얼음': 'Cloud water and ice', '기류': 'Wind', '표층 해류': 'Surface current', '이 지점의 물질': 'Materials at this location', '받는 햇빛': 'Incoming sunlight', '식생 적합도': 'Vegetation suitability', '휴면 씨앗': 'Dormant seeds', '수분·염분·온도 변화': 'Moisture, salinity, and temperature', '수분': 'Moisture', '염분': 'Salinity', '소성 진행': 'Firing progress', '최근 온도 변화': 'Recent temperature change', '행성 전체': 'Whole planet', '액체 물': 'Liquid water', '동물 생물량': 'Animal biomass', '표면 온도 범위': 'Surface temperature range', '전체 과제': 'All expeditions', '모든 탐사 완료': 'All expeditions complete', '다른 환경에서 새로운 균형을 만들어보세요.': 'Try creating a new balance in a different environment.', '진행 중': 'In progress',
  '밤': 'Night', '얼음이 녹아야 자랄 수 있어요.': 'The ice must melt before it can grow.', '모래·점토·토양이 있어야 뿌리를 내릴 수 있어요.': 'Roots need sand, clay, or soil.', '소량의 물을 공급하세요.': 'Add a small amount of water.', '물이 너무 깊습니다.': 'The water is too deep.', '햇빛을 기다리고 있어요.': 'Waiting for sunlight.', '식생이 자랄 수 있는 환경입니다.': 'Conditions support vegetation growth.', '씨앗이 정착할 수 있는 환경입니다.': 'Conditions allow seeds to establish.', '씨앗이나 식생을 도입하면 정착할 수 있어요.': 'Introduce seeds or vegetation to help it establish.', '온도와 염분을 확인하세요.': 'Check the temperature and salinity.', '분산 흔적 있음': 'Dispersal recorded', '현재 구름 없음': 'No clouds currently', '현재 강수 없음': 'No precipitation currently', '일시정지 · 마지막 강수 분포': 'Paused · showing last precipitation', '약': 'Low', '강': 'High', '자전축': 'Rotation axis', '강수': 'Precipitation', '표시 레이어': 'Display layers', '색: 속도 · 화살표: 방향 · 0 →': 'Color: speed · arrows: direction · 0 →', '색': 'Color', '속도': 'speed', '방향': 'direction', '차고 건조': 'Cold and dry', '차고 습함': 'Cold and humid', '따뜻하고 건조': 'Warm and dry', '따뜻하고 습함': 'Warm and humid',
  '행성과 시간 조작': 'Planet and time controls', '행성 상세 조정': 'Planet settings', '자전 설정': 'Rotation settings', '자전': 'Rotation', '행성 조정': 'Planet settings', '화면 회전 고정': 'Lock view rotation', '실제 자전 속도': 'Planet rotation speed', '자전축 기울기': 'Axial tilt', '자전 주기': 'Rotation period', '동기 자전 중': 'Synchronous rotation', '동기 자전': 'Synchronous rotation', '단면 설정': 'Section settings', '단면 조정': 'Section controls', '단면 보기에서 조정할 수 있습니다.': 'Adjust these controls in section view.', '절단 방향': 'Section orientation', '절단 기울기': 'Section tilt', '관찰 띠 폭': 'Observation band width', '도구 패널 펼치기': 'Expand tools panel', '관측 패널 펼치기': 'Expand observation panel', '화면과 재생 설정': 'View and playback settings', '시점 조작': 'View controls', '카메라 시점': 'Camera view', '구면': 'Globe', '단면': 'Section', '자전축으로 정렬': 'Align to rotation axis', '자전축으로 정렬 · 현재 시점에서 한 번 맞추기': 'Align to rotation axis · adjust the current view once', '확대와 축소': 'Zoom controls', '확대': 'Zoom in', '축소': 'Zoom out', '시점 되돌리기': 'Reset view', '처음 시점으로': 'Return to initial view', '시뮬레이션 재생': 'Simulation playback', '물리 한 단계 진행': 'Advance one physics step', '한 단계 진행 · 일시정지 중에 사용': 'Advance one step · available while paused', '시뮬레이션 배속': 'Simulation speed', '배속 낮추기': 'Decrease speed', '배속 높이기': 'Increase speed', '단면 드래그 동작': 'Section drag behavior', '회전': 'Rotate', '이동': 'Pan', '범위 맞춤': 'Fit range', '범위·배율': 'Range and scale', '단면 관찰 범위와 층 배율 조절': 'Adjust section range and layer scale', '관찰 범위': 'Observation range', '층 확대': 'Layer magnification', '자동': 'Auto', '기반암 숨김 · 혼합 입자': 'Bedrock hidden · mixed particles',
  '물의 여정': 'Water journey', '수증기 1kg과 구름 0.1kg을 만드세요.': 'Create 1 kg of water vapor and 0.1 kg of clouds.', '흙을 굽다': 'Firing clay', '도자기 1kg을 만들거나 보관하세요.': 'Create or store 1 kg of ceramic.', '녹이고 식히다': 'Melt and cool', '유리 1kg을 만들거나 보관하세요.': 'Create or store 1 kg of glass.', '첫 정원': 'First garden', '얕은 물과 햇빛으로 식생을 9kg까지 키우세요. 유기물은 성장을 돕습니다. 보상: 초식 생물 4kg.': 'Grow 9 kg of vegetation with shallow water and sunlight. Organic matter helps. Reward: 4 kg of herbivores.', '먹이의 연결': 'The food chain', '식생을 먹는 초식 생물을 4.2kg까지 키우세요. 보상: 포식 생물 1kg.': 'Grow 4.2 kg of herbivores that feed on vegetation. Reward: 1 kg of carnivores.', '함께 사는 세계': 'A shared world', '식생 2kg·초식 생물 1kg·포식 생물 0.2kg이 함께 있는 행성을 만드세요.': 'Create a planet with 2 kg of vegetation, 1 kg of herbivores, and 0.2 kg of carnivores.', '우주에서 온 금속': 'Metal from space', '운석을 충돌시키고 운철 1kg을 회수하세요.': 'Strike the planet with a meteor and collect 1 kg of iron meteorite.', '행성을 잇다': 'Connect the planets', '두 번째 행성으로 보관함 물질을 옮기세요.': 'Transfer material from the inventory to a second planet.',
  '고체': 'Solid', '액체': 'Liquid', '용융': 'Molten', '상 모델 제한': 'Phase model limit', '삼중점 이하 근사': 'below triple-point approximation', '180°C 상한 근사': '180°C upper-limit approximation', '편집 적용 · 다음 단계에서 반응': 'Edit applied · changes on next step', '시간이 멈춰 있어요.': 'Time is paused.', '점토가 소성되고 있어요.': 'Clay is firing.', '식어서 소성이 멈춰있어요.': 'Firing stopped as it cooled.', '용융 실리카가 온도에 따른 점성으로 흐릅니다.': 'Molten silica flows with temperature-dependent viscosity.', '용융 실리카가 식으며 유리로 굳고 있어요.': 'Molten silica is cooling into glass.', '얼음과 물의 상태를 관측 중이에요.': 'Observing the state of ice and water.',
  '기압': 'Pressure', '해류': 'Ocean current', '습도': 'Humidity', '기단': 'Air mass', '구름량': 'Cloud cover', '현재 표면 물질': 'Current surface material', '지표 열 저장층 · −30 → 50°C': 'Surface heat storage · −30 → 50°C', '기체 기둥 무게 · 0.6 → 1.4 atm': 'Weight of gas column · 0.6 → 1.4 atm', '응축물이 가장 많은 대기층 · 0 → 100%': 'Layer with most condensate · 0 → 100%', '차고 건조 · 차고 습함 · 따뜻하고 건조 · 따뜻하고 습함': 'Cold and dry · cold and humid · warm and dry · warm and humid', '물방울 + 구름 얼음 · 0 → 0.3 kg/m²': 'Water droplets + cloud ice · 0 → 0.3 kg/m²', '식생 이용 가능 물 · 0 → 0.3 kg/셀': 'Water available to vegetation · 0 → 0.3 kg/cell', '정착 가능 씨앗 · 0 → 1 (게임 지수)': 'Viable seeds · 0 → 1 (game index)', '색: 속도 · 화살표: 방향 · 0 → 100 m/s': 'Color: speed · arrows: direction · 0 → 100 m/s', '색: 속도 · 화살표: 방향 · 0 → 0.035 rad/게임초': 'Color: speed · arrows: direction · 0 → 0.035 rad/game second',
  '작은 세계를 준비하고 있어요.': 'Preparing your small world.', '지형과 물질을 불러오는 중': 'Loading terrain and materials', '준비 중': 'Starting', '계산 대기': 'Waiting to calculate', '일시정지': 'Paused', '실제 측정 중': 'Measuring actual speed', '시점 이동 중': 'Moving viewpoint',
  '행성 전환': 'Switch planet', '행성 이름 변경': 'Rename planet', '행성 이름': 'Planet name', '이름 저장': 'Save name', '이름 변경 취소': 'Cancel rename', '저장 · Enter': 'Save · Enter', '취소 · Esc': 'Cancel · Esc',
  '모래': 'Sand', '물': 'Water', '점토': 'Clay', '소금': 'Salt', '질소': 'Nitrogen', '메탄': 'Methane', '이산화탄소': 'Carbon dioxide', '유기물': 'Organic matter', '식생': 'Vegetation', '초식 생물': 'Herbivore', '포식 생물': 'Carnivore', '운철': 'Iron meteorite', '얼음': 'Ice', '도자기': 'Ceramic', '유리': 'Glass',
  '재료를 골라 행성에 부어보세요.': 'Choose a material and pour it onto the planet.', '작은 세계 다루기': 'Working with your small world', '행성에서 발견한 물질과 현상입니다.': 'Materials and phenomena discovered on this planet.',
  '측정값': 'Measurements', '항목': 'Measure', '단위': 'Unit', '현재': 'Current', '기준': 'Baseline', '보존 수지': 'Conservation budget', '관측 기준 대비': 'Compared with observation baseline',
  '행성을 만들고 모래·물·열을 더해보세요. 한 지점을 고정하면 표면 온도와 날씨가 어떻게 바뀌는지 볼 수 있어요.': 'Create a planet and add sand, water, and heat. Pin a location to see how its surface temperature and weather change.',
  '캠페인과 샌드박스의 행성과 보관함은 따로 저장됩니다.': 'Campaign and sandbox planets and inventories are saved separately.',
  '물질을 발견하고 탐사 과제를 진행합니다. 생성물과 생물은 보관함 수량만큼 사용합니다.': 'Discover materials and complete expeditions. Crafted materials and life are limited by your inventory.',
  '모든 물질을 처음부터 무제한으로 붓습니다. 탐사 과제와 보상은 적용되지 않습니다.': 'Pour unlimited amounts of every material from the start. Expeditions and rewards are disabled.',
  '관측 조건과 과학적 근거를 함께 기록합니다.': 'Observation conditions and scientific context are recorded together.',
  '실험은 자동으로 저장되고, 다음에 열면 이어집니다.': 'Your experiment is saved automatically and will be ready when you return.',
  '무엇으로 이루어진 행성을 만들까요?': 'What should this planet be made of?', '주요 구성 물질': 'Primary material', '태양에서의 위치': 'Position relative to the Sun', '태양과의 거리': 'Distance from the Sun',
  '뜨겁게': 'Hot', '온화하게': 'Temperate', '차갑게': 'Cold', '받는 에너지': 'Incoming energy', '초기 온도': 'Initial temperature', '공전 주기': 'Orbital period',
  '초기 대기와 중력': 'Initial atmosphere and gravity', '대기 주성분': 'Main atmospheric gas', '초기 대기 없음': 'No initial atmosphere', '초기 기체량': 'Initial gas amount', '중력 · 지구 기준': 'Gravity · relative to Earth', '씨앗이 있는 행성': 'Add dormant seeds', '이 조건으로 행성 만들기': 'Create planet with these settings',
  '행성 표면을 눌러 관찰 지점을 고정하세요. Esc로 취소': 'Click the planet surface to pin an observation point. Esc to cancel', '시점 회전 조이스틱': 'View rotation joystick', '드래그해서 시점 회전': 'Drag to rotate the view',
  '구형 행성 실험': 'Spherical planet experiment', '행성. 기본은 그랩 모드입니다. 재료 선택 후 왼쪽 드래그로 붓기. 오른쪽 드래그로 회전. 휠로 확대. 터치에서는 한 손가락으로 붓고 두 손가락으로 회전합니다.': 'Planet. Starts in grab mode. Select a material and drag with the left button to pour. Drag with the right button to rotate. Use the wheel to zoom. On touch screens, pour with one finger and rotate with two.',
  '지도 범례': 'Map legend', '처음 실험 안내': 'First experiment guide', '관측 지도: 물질': 'Observation map: Material', '항성계의 행성 만들기': 'Create planet in the star system',
  '규사 · 입자': 'Silica · grains', 'H₂O · 액체': 'H₂O · liquid', '광물 혼합물': 'Mineral mixture', 'NaCl · 결정': 'NaCl · crystals', 'N₂ · 기체': 'N₂ · gas', 'CH₄ · 기체': 'CH₄ · gas', 'CO₂ · 기체': 'CO₂ · gas',
  '생물 잔해 · 보수력': 'Organic matter · water retention', '생물량 · 생산자': 'Biomass · producer', '생물량 · 소비자': 'Biomass · consumer', '금속 · 운석': 'Metal · meteorite', '물 · 고체': 'Water · solid', '구운 점토': 'Fired clay', '굳은 규사': 'Solidified silica',
  '조금 젖으면 서로 붙고, 흠뻑 젖으면 쉽게 흐릅니다.': 'Slightly damp sand grains stick together; saturated sand flows easily.',
  '낮은 곳으로 흐릅니다. 온도에 따라 얼거나 증발합니다.': 'Flows downhill. It freezes or evaporates depending on temperature.',
  '물과 섞으면 부드러워지고, 충분히 구우면 도자기가 됩니다.': 'Softens when mixed with water and becomes ceramic when fired.',
  '물에 녹고, 물이 줄면 결정으로 남습니다.': 'Dissolves in water and forms crystals as the water evaporates.',
  '대기에 공급되어 주변으로 퍼집니다. 새 행성의 기본 대기입니다.': 'Spreads through the atmosphere when added. It is the default gas on new planets.',
  '질소보다 가볍습니다. 같은 온도와 중력에서 더 높이 퍼집니다.': 'Lighter than nitrogen, so it spreads higher at the same temperature and gravity.',
  '질소보다 무겁습니다. 같은 온도와 중력에서 더 낮게 모입니다.': 'Heavier than nitrogen, so it settles lower at the same temperature and gravity.',
  '물을 붙잡고 식생 성장을 돕습니다. 죽은 생물과 씨앗도 유기물로 돌아옵니다. 모래·점토에서 식생이 자라는 데 필수는 아닙니다.': 'Holds water and supports vegetation. Dead organisms and seeds return to the organic matter pool. Organic matter is not required for vegetation to grow in sand or clay.',
  '씨앗·탄소원·수분·햇빛이 맞으면 모래나 점토에서도 자랍니다. 얼음·깊은 물·염분·고온에서는 쇠퇴합니다.': 'Can grow in sand or clay when seeds, a carbon source, moisture, and sunlight are available. Ice, deep water, salinity, and high temperatures cause it to decline.',
  '식생을 먹고 성장하며 주변으로 이동합니다. 먹이가 없으면 생물량이 유기물로 돌아갑니다.': 'Feeds on vegetation and moves around. Without food, its biomass returns to the organic matter pool.',
  '초식 생물을 먹습니다. 작은 양으로 시작하고 먹이의 균형을 관찰하세요.': 'Feeds on herbivores. Start with a small amount and watch the balance between predator and prey.',
  '운석 충돌로 얻는 금속입니다. 캠페인에서는 회수한 양을 다른 행성에 쓸 수 있어요.': 'A metal delivered by meteor impacts. In Campaign mode, recovered iron can be used on other planets.',
  '물을 얼려 얻습니다. 캠페인에서는 회수한 만큼 다른 행성에 쓸 수 있어요.': 'Made by freezing water. In Campaign mode, recovered ice can be used on other planets.',
  '점토를 구워 얻는 단단한 물질입니다. 캠페인에서는 회수한 만큼 공급할 수 있어요.': 'A hard material made by firing clay. In Campaign mode, recovered ceramic can be used as supply.',
  '모래를 녹인 뒤 식혀 얻습니다. 캠페인에서는 회수한 만큼 공급할 수 있어요.': 'Made by melting sand and cooling it. In Campaign mode, recovered glass can be used as supply.',
  '젖은 모래': 'Wet sand', '증발': 'Evaporation', '구름과 강수': 'Clouds and precipitation', '동결': 'Freezing', '용해': 'Dissolution', '결정화': 'Crystallization', '점토 소성': 'Clay firing', '기체 대기': 'Atmosphere',
  '소량의 물은 모래 입자 사이에 모세관 다리를 만듭니다. 물이 많아지면 구조가 약해질 수 있습니다.': 'A small amount of water forms capillary bridges between sand grains. Too much water can weaken the structure.',
  '게임에서는 건조·촉촉·포화의 세 구간으로 응집력을 바꿉니다. 구간 경계는 게임 조정값입니다.': 'The simulation uses three cohesion states: dry, damp, and saturated. The thresholds are game tuning values.',
  '물은 끓는점 아래에서도 증발합니다. 온도와 주변 수증기량에 따라 증발과 응결의 균형이 달라집니다.': 'Water evaporates below its boiling point. Temperature and the amount of water vapor in the air affect the balance between evaporation and condensation.',
  '따뜻하고 건조할수록 증발이 빨라집니다. 기체량·중력으로 보정한 기압이 비등 기준을 바꾸고, 녹은 소금은 증발을 억제합니다. 얼음도 건조한 공기에서 승화하며 필요한 열을 소비합니다.': 'Evaporation is faster in warm, dry conditions. Pressure, adjusted for gas amount and gravity, changes the boiling point; dissolved salt slows evaporation. Ice also sublimates in dry air, absorbing heat as it does.',
  '구름은 공중에 떠 있는 작은 물방울과 얼음 입자입니다. 응결만으로 바로 비가 되지는 않습니다. 입자가 성장해야 강수가 되고, 건조한 공기에서는 다시 증발할 수 있습니다.': 'Clouds are tiny water droplets and ice particles suspended in the air. Condensation does not immediately make rain: particles must grow before they precipitate, and they can evaporate again in dry air.',
  '각 대기층의 온도·기압·수증기량으로 응결을 계산합니다. 부력 상승에 따른 단열 냉각과 잠열을 반영하고 바람이 물방울·얼음을 운반합니다. 강수 성장과 침강 속도는 대표값으로 근사하며, 현재 구름은 물로 이루어집니다.': 'Condensation is calculated from each atmospheric layer’s temperature, pressure, and water vapor. The model includes adiabatic cooling from buoyant ascent and latent heat; winds carry droplets and ice. Precipitation growth and fall speeds use representative values. Clouds currently consist of water.',
  '담수는 약 0°C, 보통의 해수는 약 −2°C에서 얼기 시작합니다. 얼음이 생기면서 남은 물의 염분이 높아집니다.': 'Fresh water begins to freeze near 0°C; typical seawater does so near −2°C. As ice forms, the remaining water becomes saltier.',
  '열이 빠져나간 만큼 얼음이 생깁니다. 해수보다 진한 염수의 어는점은 게임용 근사값입니다.': 'Ice forms as heat leaves the water. Freezing points for brines saltier than seawater are approximated for gameplay.',
  '소금은 물에 녹으며, 물이 담을 수 있는 양에는 한도가 있습니다.': 'Salt dissolves in water, but only up to a limit.',
  '소금은 접촉한 물에 조금씩 녹습니다. 첫 모델의 용해 한도는 물 질량의 36%로 고정합니다.': 'Salt dissolves gradually in the water it touches. The first model fixes the solubility limit at 36% of the water mass.',
  '염수가 증발하면 녹아 있던 염류가 농축되고 결정으로 남을 수 있습니다.': 'As brine evaporates, dissolved salts become more concentrated and may form crystals.',
  '용해 한도를 넘는 소금만 결정화합니다. 순수한 물에서는 소금이 생기지 않습니다.': 'Only salt above the solubility limit crystallizes. Pure water does not produce salt.',
  '점토를 가열하면 광물 구조가 바뀝니다. 필요한 온도와 시간은 조성에 따라 다릅니다.': 'Heating clay changes its mineral structure. The required temperature and time depend on its composition.',
  '건조한 대표 점토를 850°C 이상에서 행성 시간 30분 동안 유지하면 도자기가 됩니다. 이 값은 게임 규칙입니다.': 'In the simulation, a representative dry clay becomes ceramic when held above 850°C for 30 minutes of planet time. This is a game rule.',
  '석영질 모래를 녹이려면 대략 1,700°C의 높은 온도가 필요합니다.': 'Melting quartz-rich sand requires a high temperature, around 1,700°C.',
  '규사가 용융된 뒤 1,400°C 아래에서 유리로 굳습니다. 1,400°C 위로 재가열하면 다시 연화·용융되어 점성 흐름을 보입니다. 연화 범위·냉각 속도·점성은 게임 조정값입니다.': 'After silica sand melts, it solidifies into glass below 1,400°C. Reheating it above 1,400°C softens or melts it again, allowing viscous flow. The softening range, cooling rate, and viscosity are game tuning values.',
  '대기는 여러 기체의 혼합물입니다. 같은 조건에서 온도가 높거나 중력이 약하거나 평균 분자량이 작을수록 더 높이 퍼집니다.': 'An atmosphere is a mixture of gases. Under the same conditions, it extends higher when temperature is greater, gravity is weaker, or the average molecular mass is lower.',
  '수증기·질소·메탄·이산화탄소를 따로 기록합니다. 이상기체·등온 대기로 높이를 근사하고, 약한 중력에서 빠져나간 질량도 기록합니다. 메탄의 빛 흡수·햇빛에 따른 연무를 색과 불투명도로 근사합니다. 복사에 의한 온실효과는 기후 모델에서 계산하며, 메탄 화학 반응은 포함하지 않습니다.': 'Water vapor, nitrogen, methane, and carbon dioxide are tracked separately. Atmospheric scale height is approximated with an isothermal ideal-gas model, and mass lost under weak gravity is recorded. Methane’s light absorption and sunlight-driven haze are approximated through color and opacity. Radiative greenhouse effects are calculated by the climate model; methane chemistry is not included.',
  '생산자 생물량을 나타냅니다.': 'Represents producer biomass.',
  '씨앗이 있는 곳에서는 모래·점토에도 정착합니다. 탄소원과 재활용 유기물에서 질량을 얻고 빛·물·온도·염분 조건에 따라 성장합니다. 쇠퇴하면 유기물로 돌아갑니다.': 'With seeds present, vegetation can establish in sand or clay. It gains mass from a carbon source and recycled organic matter, and grows according to light, water, temperature, and salinity. Declining vegetation returns to the organic matter pool.',
  '식생을 먹는 소비자 생물량입니다.': 'Represents consumer biomass that feeds on vegetation.',
  '온도·물·염분·얼음이 섭식·이동·생존을 제한합니다. 섭식한 식생 일부는 초식 생물로, 나머지는 유기물로 이동합니다.': 'Temperature, water, salinity, and ice limit feeding, movement, and survival. Some eaten vegetation becomes herbivore biomass; the rest becomes organic matter.',
  '초식 생물을 먹는 소비자 생물량입니다.': 'Represents consumer biomass that feeds on herbivores.',
  '먹이와 온도·물·염분·얼음 조건이 생존과 이동을 제한합니다. 감소한 생물량은 유기물로 돌아갑니다.': 'Food and conditions involving temperature, water, salinity, and ice limit survival and movement. Lost biomass returns to the organic matter pool.',
  '외부에서 들어오는 운석의 금속 물질입니다.': 'Metal delivered by incoming meteorites.',
  '충돌은 열과 운철을 추가하고 기반 물질을 분화구 둘레로 옮깁니다.': 'Impacts add heat and iron, and displace underlying material around the crater.',
  'Scientific Reports · 젖은 모래 연구': 'Scientific Reports · Wet sand', 'USGS · 물과 증기압': 'USGS · Water and vapor pressure', 'NWS · 구름의 발달과 강수': 'NWS · Cloud development and precipitation', 'NSIDC · 해빙의 과학': 'NSIDC · Sea ice science', 'IUPAC–NIST · 염화나트륨 용해도': 'IUPAC–NIST · Sodium chloride solubility', 'NASA · 베누의 증발 광물': 'NASA · Evaporite minerals on Bennu', 'Journal of Archaeological Science · 점토 구조 변화': 'Journal of Archaeological Science · Clay structure changes', 'Corning · 유리 제조': 'Corning · Glassmaking', 'NASA · 행성 대기와 스케일 높이': 'NASA · Planetary atmospheres and scale height', '생태계 게임 규칙': 'Ecosystem game rules', '충돌 게임 규칙': 'Impact game rules',
  '젖은 모래 발견': 'Wet sand discovered', '증발 발견': 'Evaporation discovered', '구름과 강수 발견': 'Clouds and precipitation discovered', '동결 발견': 'Freezing discovered', '용해 발견': 'Dissolution discovered', '결정화 발견': 'Crystallization discovered', '점토 소성 발견': 'Clay firing discovered', '유리 발견': 'Glass discovered', '기체 대기 발견': 'Atmosphere discovered', '식생 발견': 'Vegetation discovered', '초식 생물 발견': 'Herbivore discovered', '포식 생물 발견': 'Carnivore discovered', '운철 발견': 'Iron meteorite discovered',
  '열이 빠져나가며 물이 얼었습니다.': 'Water froze as heat escaped.', '점토가 소성되어 도자기가 되었습니다.': 'The clay was fired into ceramic.', '녹은 규사가 식어 유리가 되었습니다.': 'The molten silica cooled into glass.', '물이 줄면서 소금 결정이 남았습니다.': 'Salt crystals remained as the water evaporated.', '물이 수증기로 이동하고 있습니다.': 'Water is evaporating into the atmosphere.', '소금이 물에 녹았습니다.': 'Salt dissolved in the water.', '소량의 물이 모래 입자를 붙잡습니다.': 'A small amount of water is binding the sand grains.', '기체 조성과 양이 대기 높이에 반영됩니다.': 'Gas composition and quantity affect the atmosphere’s height.', '수증기가 구름 속 물방울·얼음으로 모였습니다.': 'Water vapor condensed into cloud droplets and ice.',
  '미관측': 'Not observed', '발견함': 'Discovered', '행성의 물질량': 'Planetary inventory', '수증기': 'Water vapor', '구름 · 물방울과 얼음': 'Clouds · droplets and ice', '소금 · 고체와 용액': 'Salt · solid and dissolved',
  '사라진 물은 수증기나 얼음으로 이동합니다. 수증기는 구름 속 물방울·얼음이 되고, 충분히 모이면 비·눈으로 내려옵니다. 붓기·깎기·우주로의 탈출은 외부와의 물질 교환입니다.': 'Water that leaves the surface moves into vapor or ice. Vapor can form cloud droplets and ice, which may fall as rain or snow when enough accumulates. Pouring, removing material, and escape into space exchange matter with the outside world.',
  '구면 표면층 모델입니다. 생태계는 유기물·식생·초식·포식 생물의 질량과 먹이 관계로 계산합니다. 개체별 행동과 내부 동굴은 포함하지 않습니다.': 'This is a spherical surface-layer model. The ecosystem tracks the mass and feeding relationships of organic matter, vegetation, herbivores, and carnivores. Individual behavior and underground caves are not modeled.',
  '전체 인벤토리': 'Full inventory', '인벤토리 닫기': 'Close inventory', '물질 찾기': 'Find a material', '이름 또는 성질로 검색': 'Search by name or property', '기본': 'Basic', '광물': 'Discoveries', '생태': 'Life',
  '알림 센터 열기': 'Open notifications',
  '행성 그랩. 클릭해 관찰하고 드래그로 회전하세요. 재료를 선택해야 물질이 부어집니다.': 'Planet in Grab mode. Click to observe and drag to rotate. Select a material before pouring.', '행성 작업. 선택한 재료나 도구로 표면을 수정합니다. 그랩 또는 Esc로 작업을 해제하세요.': 'Planet editing mode. Modify the surface with the selected material or tool. Choose Grab or press Esc to stop.',
  '습한 모래나 점토에도 식생을 도입할 수 있어요.': 'Vegetation can take root in damp sand or clay.', '식생이 자란 곳에 초식 생물을 놓으세요.': 'Place herbivores where vegetation is growing.', '먹이가 있는 곳에 포식 생물을 놓으세요.': 'Place predators where prey is available.', '운철을 놓아보세요.': 'Place an iron meteorite.', '물을 부어보세요.': 'Try pouring water.', '점토를 부어보세요.': 'Try pouring clay.', '소금을 부어보세요.': 'Try pouring salt.', '얼음을 놓아보세요.': 'Place some ice.', '도자기를 놓아보세요.': 'Place some ceramic.', '유리를 놓아보세요.': 'Place some glass.', '질소를 대기에 공급하세요.': 'Add nitrogen to the atmosphere.', '메탄을 대기에 공급하세요.': 'Add methane to the atmosphere.', '이산화탄소를 대기에 공급하세요.': 'Add carbon dioxide to the atmosphere.', '열빛과 수증기를 관찰하세요.': 'Observe the glow and water vapor.', '냉각해 얼음을 만들어보세요.': 'Cool the surface to make ice.', '표면을 조금씩 깎아보세요.': 'Remove material from the surface.', '표면의 생성물과 생물을 회수하세요.': 'Collect products and organisms from the surface.', '충돌시킬 지점을 누르세요.': 'Click where the meteor should strike.', '드래그 · 시점 회전': 'Drag to rotate the view',
  '첫 번째 실험 · 추천 설정': 'FIRST EXPERIMENT · SUGGESTED SETTINGS', '작은 암석 행성에서 시작해요': 'Start with a small rocky planet', '태양에서 1 AU 떨어진 암석 행성을 만듭니다. 나중에 항성계에서 다른 행성도 만들 수 있어요.': 'Create a rocky planet 1 AU from the Sun. You can add other planets to the system later.', '추천 설정으로 행성 만들기': 'Create planet with suggested settings', '재료와 궤도 직접 정하기': 'Choose materials and orbit',
  '모래를 골라보세요': 'Choose sand', '실험 도구에서 모래를 고르면 붓기 모드가 됩니다. 아래 버튼으로 바로 선택할 수도 있어요.': 'Choose sand in the tools panel to enter pour mode, or select it with the button below.', '모래 선택': 'Select sand', '행성에 부어보세요': 'Pour onto the planet', '행성 표면을 누르거나 드래그해 선택한 물질을 부어보세요. 그랩을 누르면 다시 시점을 돌릴 수 있어요.': 'Click or drag on the planet to pour the selected material. Choose Grab to rotate the view again.', '행성을 눌러주세요': 'Click the planet', '변화를 관찰해보세요': 'Observe the changes', '관측 패널에서 표면의 상태를 보고, 관찰 핀으로 한 지점을 고정해보세요. 실험은 자동 저장됩니다.': 'Check the surface in the observation panel, then pin a location to follow it. Your experiment is saved automatically.', '실험 계속하기': 'Continue experimenting', '안내 닫기': 'Close guide',
  '이메일': 'Email', '비밀번호': 'Password', '로그인': 'Sign in', '회원가입': 'Create account', 'Google로 로그인': 'Continue with Google', '비밀번호 재설정': 'Reset password', '지금 저장': 'Save now', '로그아웃': 'Sign out',
  '비회원 · 이 브라우저에 저장': 'Guest · saved in this browser', '이 브라우저의 비회원 게임 가져오기': 'Import guest game from this browser', '가져오기는 현재 계정에 저장된 게임이 없을 때 사용할 수 있습니다.': 'You can import a guest game only when this account has no saved game.', '진행 상황 선택': 'Choose a save', '이 기기와 클라우드에 서로 다른 진행 상황이 있습니다. 선택 전의 로컬 저장본은 복구용으로 보관합니다.': 'This device and the cloud have different saves. A copy of the local save will be kept for recovery before you choose.', '클라우드 게임 이어하기': 'Continue with cloud save', '이 기기 게임 저장하기': 'Use this device’s save',
  '클라우드 저장 확인 중': 'Checking cloud save', '로그인하면 다른 기기에서도 게임을 이어할 수 있습니다.': 'Sign in to continue your game on other devices.', '계정 저장 연결을 준비 중입니다. 게임은 이 브라우저에 보관됩니다.': 'Setting up account saves. Your game is stored in this browser for now.', '이메일과 비밀번호를 확인하세요.': 'Check your email and password.', '이미 가입된 이메일입니다. 로그인해주세요.': 'This email is already registered. Sign in instead.', '비밀번호는 6자 이상 입력하세요.': 'Enter a password with at least 6 characters.', '로그인을 취소했습니다.': 'Sign-in was canceled.', '인터넷 연결을 확인하세요.': 'Check your internet connection.', '요청이 많습니다. 잠시 후 다시 시도하세요.': 'Too many requests. Try again in a moment.', '계정 저장 권한을 확인하지 못했습니다. 잠시 후 다시 시도하세요.': 'Could not verify account save permissions. Try again in a moment.', '계정 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.': 'Could not connect to the account service. Try again in a moment.', '계정 작업을 완료하지 못했습니다.': 'Could not complete the account action.', '재설정 안내를 요청했습니다. 이메일을 확인하세요.': 'Password reset instructions were requested. Check your email.',
  '플레이 방식 선택': 'Choose a game mode',
  '샌드박스에서는 무제한으로 공급합니다.': 'Supply is unlimited in Sandbox mode.', '공유 보관함에서 공급': 'Supplied from shared inventory', '표면의 생성물을 회수해 보관함에 담으세요.': 'Collect products from the surface to add them to your inventory.', '행성에서 생성하면 발견됩니다.': 'Discovered when created on a planet.', '선택하면 붓기, 다시 누르면 해제합니다.': 'Select to pour; select again to stop.',
  '기본 상태에서는 클릭해도 재료가 부어지지 않습니다. 왼쪽·오른쪽 드래그로 회전하세요.': 'In Grab mode, clicking does not pour material. Drag with either mouse button to rotate.', '재료를 선택한 뒤 왼쪽 버튼으로 누르거나 드래그. 그랩 또는 Esc로 해제': 'Select a material, then click or drag with the left mouse button to pour. Choose Grab or press Esc to stop.', '행성 화면 좌상단의 핀을 누르고 표면을 눌러 고정하세요. 표면을 다시 누르거나 핀 해제로 관측 지점을 바꿀 수 있습니다.': 'Select the pin at the upper left of the planet view, then click the surface to set an observation point. Click another spot or clear the pin to change it.', '오른쪽 드래그 · 화면 오른쪽 아래 조이스틱': 'Right-drag or use the joystick at the lower right of the screen.', '휠 또는 화면의 + / − 버튼': 'Use the mouse wheel or the + / − buttons on screen.', '한 손가락 붓기 · 두 손가락 회전': 'Pour with one finger; rotate with two.', '물질과 가열·냉각·깎기·회수 버튼을 선택하세요.': 'Choose a material or select Heat, Cool, Erase, or Collect.', '생성물과 생물을 회수하고 전체 인벤토리에서 꺼내 쓰세요.': 'Collect products and organisms, then use them from the full inventory.', '항성계에서 행성을 누르면 카메라가 해당 행성으로 이동합니다.': 'Select a planet in the star system to move the camera to it.',
  '구면·단면 버튼으로 같은 세계를 연속 전환하세요. 단면은 표면을 확대해 보여줍니다. 그랩·오른쪽 드래그로 절단면을 두 축으로 돌리고 이동 버튼 또는 Shift+드래그로 화면을 옮기세요. 구면에서 단면을 누르면 절단선과 선택 셀이 나타납니다. A·B를 드래그하고 선택한 단면 열기를 누르세요. 끝점에 초점을 두고 방향키로도 조정할 수 있습니다. 행성 조정에서 절단 방향·기울기·띠 폭도 바꿀 수 있어요. 정지 중에는 클릭·드래그한 지점만 편집하며 반응과 낙하는 한 단계 또는 재생으로 진행합니다.': 'Use Sphere and Section to switch between views of the same world. Section zooms in on the surface. In Grab mode, right-drag to rotate the cut along two axes; use the move control or Shift-drag to pan. In Sphere view, select Section to show the cut line and selected cells. Drag A and B, then choose Open selected section. You can also focus an endpoint and adjust it with the arrow keys. Planet settings let you change the cut direction, tilt, and band width. While paused, only the clicked or dragged area is edited; reactions and falling material advance one step at a time or while playing.',
  '궤도 거리는 생성 후 고정되고 공전 주기를 정합니다. 하단의 행성 조정을 펼쳐 자전축과 자전 주기를 조절하세요. 동기 자전은 한쪽 면이 계속 태양을 보게 합니다. 화면 회전 고정은 관찰 화면만 멈추며, 실제 자전은 속도를 0으로 설정해야 멈춥니다.': 'Orbital distance is fixed after creation; orbital period determines how long one orbit takes. Expand Planet settings below to change the rotation axis and period. Synchronous rotation keeps one side facing the Sun. Locking the view rotation affects only the camera; set the rotation speed to zero to stop the planet itself.', '항성계의 행성 만들기 버튼에서 주요 물질·궤도·대기·중력을 정하세요.': 'Choose a planet’s primary material, orbit, atmosphere, and gravity with Create planet in the star system.', '수증기 → 구름 → 비·눈. 구름은 이동하거나 다시 증발해요.': 'Water vapor forms clouds, then rain or snow. Clouds can move or evaporate again.', '화면 좌하단의 대기·구름·강수 버튼으로 숨기거나 표시하세요. 숨겨도 물질의 순환은 계속됩니다.': 'Use the atmosphere, clouds, and precipitation controls at the lower left to show or hide these layers. Hiding them does not stop the material cycle.',
  '키보드 보조 조작': 'Keyboard shortcuts', '1–4 물질 선택 · G 가열 · C 냉각 · X 깎기 · Esc 그랩': '1–4 Select material · G Heat · C Cool · X Erase · Esc Grab', 'Space 재생 · R 처음 시점 · P 관찰 핀 지정 · Shift+드래그 구면 회전 / 단면 이동': 'Space Play · R Reset view · P Set observation pin · Shift-drag Rotate sphere / pan section', '행성에 초점을 두면 방향키 회전 · Enter 붓기 (핀 지정 중에는 화면 중앙에 핀)': 'When the planet is focused: arrow keys rotate · Enter pours (sets the pin at screen center while pin mode is active)', '점토를 붓고 가열 도구로 850°C 이상을 유지하면 도자기가 됩니다. 모래는 1,700°C 위에서 녹고 식으면 유리가 됩니다. 기본 목표는 현실 1초당 행성 시간 1분입니다. 계산이 느리면 하단에 실제 진행 속도가 따로 표시됩니다.': 'Hold clay above 850°C with the Heat tool to make ceramic. Sand melts above 1,700°C and becomes glass as it cools. The default target is one minute of planet time per real-world second. If the simulation runs more slowly, its actual rate appears at the bottom.',
};

const contextualTranslations: Record<string, string> = {
  'inventory.category.crafted': 'Discoveries',
  'dashboard.page.overview': 'Overview',
  'dashboard.page.matter': 'Matter',
  'dashboard.page.ecology': 'Ecology',
  'notice.kind.discovery': 'Discovery',
};

// Secondary UI vocabulary lives separately so feature teams can extend coverage
// without silently replacing an existing translation.
const additionalTranslations: Record<string, string> = {
  '무제한': 'Unlimited', '1셀': '1 cell', '셀': 'cells', '겹 확장': 'Expand layers', '진행 없음': 'No progress',
  'CPU 계산으로 계속하고 있어요.': 'Continuing with CPU calculations.', '기체 없음': 'No gases', '기체 조성: ': 'Gas composition: ',
  '· 이어짐': '· resumed', '행성과 대시보드 기록이 이 브라우저에 자동 저장됨': 'Planet and dashboard data are saved automatically in this browser.', '자동 저장이 다시 정상 동작합니다.': 'Automatic saving is working again.', '· 저장 불가': '· Save unavailable', '자동 저장하지 못했습니다.': 'Could not save automatically.', '브라우저의 저장 공간과 저장 권한을 확인하세요.': 'Check this browser’s storage space and permissions.',
  '클라우드 저장에 실패했습니다. 이 기기에 게임을 보관했으며 지금 저장에서 다시 시도할 수 있습니다.': 'Cloud save failed. Your game is safe on this device; try again with Save now.', '클라우드 저장본을 먼저 확인하세요.': 'Check the cloud save first.', '클라우드에 저장 중…': 'Saving to cloud…', '모드를 저장하지 못했습니다.': 'Could not save the mode.', '모드를 바꾸지 못했습니다.': 'Could not change the mode.', '먼저 행성을 만들거나 비회원 게임을 가져오세요.': 'Create a planet or import a guest game first.', '클라우드 저장본이 없습니다.': 'No cloud save found.', '이 기기에 저장된 게임이 없습니다.': 'No game is saved on this device.', '현재 계정에 게임이 있습니다. 비회원 게임 가져오기는 빈 계정에서만 가능합니다.': 'This account already has a game. Guest games can only be imported into an empty account.', '이 브라우저에 비회원 게임이 없습니다.': 'No guest game found in this browser.',
  '충돌 지점에 운철 36kg이 남았습니다. 회수 도구로 모으세요.': 'The impact left 36 kg of iron meteorite. Collect it with the Collect tool.', '새 행성을 만들었습니다.': 'Planet created.', '소진된 생물 표본을 다시 보급했습니다.': 'Depleted life samples have been restocked.', '보관함이나 행성에 표본이 남아 있습니다. 회수해서 사용할 수 있어요.': 'Samples remain in the inventory or on a planet. Collect them to use them.', '샌드박스에서는 무제한으로 공급합니다.': 'Supply is unlimited in Sandbox mode.', '새 행성 만들기': 'Create a new planet', '네 행성을 함께 실험할 수 있어요.': 'Experiment with up to four planets together.', '한 번에 붓는 양': 'Amount per pour', '일시 정지': 'Paused', '자전축 정렬 · 구면 화면에서 사용': 'Align rotation axis · available in Globe view', '좁게': 'Narrow', '넓게': 'Wide', '보통': 'Medium', '서로 다른 진행 상황을 발견했습니다. 사용할 저장본을 선택하세요.': 'Different saves were found. Choose which one to use.', '계정 게임을 불러왔습니다.': 'Account save loaded.', '계정에 저장된 게임이 없습니다. 새 행성을 만들거나 비회원 게임을 가져오세요.': 'No game is saved to this account. Create a planet or import a guest game.', '클라우드에 연결하지 못했습니다. 이 기기의 저장본으로 진행하며 지금 저장에서 다시 시도할 수 있습니다.': 'Could not connect to cloud storage. You can continue with this device’s save and try again with Save now.', '지금은 계정 연결을 사용할 수 없습니다. 게스트 게임은 이 브라우저에 저장됩니다.': 'Account linking is unavailable right now. Guest games are saved in this browser.', '행성을 불러오지 못했어요.': 'Could not load the planet.', '저장 데이터와 그래픽 초기화를 확인해주세요.': 'Check the saved data and graphics initialization.',
  '소금 결정': 'Salt crystals', '기반암': 'Bedrock', '용융 규사': 'Molten silica', '기반암이 녹았습니다.': 'Bedrock melted.', '염수': 'Brine', '암석': 'Rock', '화면 회전 재개': 'Resume view rotation', '현재 대기 없음': 'No atmosphere currently', '핀 · 표면을 눌러 관찰 지점 옮기기': 'Pin · click the surface to move the observation point', '핀 · 표면을 눌러 관찰 지점 고정': 'Pin · click the surface to fix the observation point', '고정한 지점': 'Pinned location', '반대편': 'Far side', '화면 밖': 'Off screen', '고정된 관찰 지점': 'Pinned observation point', '이 지점으로 시점 이동': 'Center view on this location', '가장자리에 방향 표시': 'Direction shown at edge', '핀 고정': 'Pin location', '선택한 행성의 관측 기록이 없습니다.': 'No observation history for the selected planet.', '일부 대시보드 기록을 불러오지 못했습니다.': 'Some dashboard history could not be loaded.', '읽지 못한 원본은 복구용 저장본으로 보존했습니다. 행성 데이터는 정상적으로 불러왔습니다.': 'A recovery copy of unreadable data was saved. Planet data loaded successfully.',
  '절단선 선택': 'Select a section line', '양 끝 셀을 드래그해 범위를 선택하세요.': 'Drag the endpoint cells to select a range.', '선택한 단면 열기': 'Open selected section', '취소': 'Cancel', '절단선 시작점': 'Section line start point', '절단선 끝점': 'Section line end point', '드래그 또는 방향키로 절단선 끝점 이동': 'Drag or use the arrow keys to move the section endpoint', '표면에 고정 기반만 있습니다': 'Only fixed bedrock is present at the surface', '표면 → 층 바닥': 'Surface → layer base', '표면 → 기반': 'Surface → bedrock', '고정 기반': 'Fixed bedrock', '물층': 'Water layer', '고체 혼합층': 'Solid mixture layer', '녹은 소금': 'Dissolved salt', '깊이별 분포': 'Depth profile', '깊이별 분포 설명': 'Depth profile help', '상대 깊이': 'relative depth', '깊이': 'depth', '부터': 'to', '두께': 'thickness', '층 바닥': 'layer base',
  '작은 항성계': 'A small star system', '행성을 누르면 가까이 이동합니다.': 'Select a planet to move closer.', '공유 보관함': 'Shared inventory', '현재 행성으로 돌아가기': 'Return to current planet', '표면 생성물 없음': 'No surface products', '변화 중': 'Changing', '항성계 탐색': 'Explore star system', '행성 만들기': 'Create planet', '행성 이름 변경': 'Rename planet', '행성 이름': 'Planet name', '이름을 입력하세요.': 'Enter a name.', '이름을 저장했습니다.': 'Name saved.', '이름을 입력하세요': 'Enter a name', 'Enter 저장': 'Enter Save', 'Esc 취소': 'Esc Cancel', '행성 전환': 'Switch planet',
  '전체': 'Overview', '물질': 'Matter', '열 상태': 'Thermal state', '물 순환': 'Water cycle', '생태': 'Ecology', '수지 검증': 'Budget validation', '표면 온도 · 평균 / P10 / P90': 'Surface temperature · mean / P10 / P90', '온도 범위 · 최소 / 평균 / 최대': 'Temperature range · min / mean / max', 'H₂O 상 분포': 'H₂O phase distribution', '강수율 · 실제값': 'Precipitation rate · absolute', '대기 압력': 'Atmospheric pressure', '기체 몰 분율': 'Gas mole fraction', '질량 분포': 'Mass distribution', '먹이망 · 질량': 'Food web · mass', '셀 점유율': 'Cell coverage', '누적 에너지 교환 · 기준 대비': 'Cumulative energy exchange · relative to baseline', '누적 외부 질량 교환 · 기준 대비': 'Cumulative external mass exchange · relative to baseline', '행성 대시보드': 'Planet dashboard', 'CSV 불러오기': 'Import CSV', '선택한 행성의 이전 시계열 CSV 불러오기': 'Import an earlier time-series CSV for the selected planet', '이전에 저장한 기록을 포함한 모든 시계열 · CSV': 'All time series, including previously saved records · CSV', '대시보드 닫기': 'Close dashboard', '차트 시간 범위': 'Chart time range', '최근 1시간': 'Last hour', '최근 5시간': 'Last 5 hours', '차트 값 표시': 'Chart value display', '실제값': 'Absolute values', 'Δ 기준': 'Δ from baseline', '현재 값을 새 기준으로 설정 · 선택한 행성의 관측 기록 초기화': 'Set current values as the new baseline · reset observations for the selected planet', '현재 값을 관측 기준으로 설정': 'Set current values as baseline', '데이터 분류': 'Data categories', '호버 또는 ← → 키로 관측값 조회': 'Hover or use ← → to inspect readings', '측정값': 'Measurements', 'Δ = 현재 − 기준': 'Δ = current − baseline', '항목': 'Measure', '단위': 'Unit', '현재': 'Current', '기준': 'Baseline', 'Δ %': 'Δ %', '보존 수지': 'Conservation budget', '관측 기준 대비': 'Relative to observation baseline', '표면 온도 분포': 'Surface temperature distribution', '셀 비율 % · 현재': 'Cell fraction % · current', '질량 조성': 'Mass composition', '기체 몰 조성': 'Gas mole composition', '낙하 · 투입 대기 제외': 'Excludes falling material and pending input', '몰 분율 %': 'Mole fraction %', 'CSV 파일은 8 MB 이하여야 합니다.': 'CSV files must be 8 MB or smaller.', 'CSV 기록을 합쳤습니다.': 'CSV history imported.', 'CSV 기록을 불러오지 못했습니다.': 'Could not import CSV history.', '등온 구면 근사': 'Isothermal spherical approximation', '프로파일 유효': 'Profile valid', '프로파일 모델 범위 초과': 'Outside the profile model range', '기록 자동 저장': 'History saved automatically', '기본 행성 1분/표본': 'Default: one sample per planet minute', '이전 구간 압축': 'Earlier intervals were compressed', '관측 공백': 'Observation gap', '관측 공백의 에너지 교환이 기록되지 않아 전체 수지를 계산할 수 없습니다.': 'Energy exchange during the gap was not recorded, so the full budget cannot be calculated.', '기록이 없는 구간은 차트를 연결하지 않습니다. 누적 에너지와 강수량은 기록된 구간만 합산합니다. 공백을 포함하는 전체 에너지 수지는 계산하지 않습니다.': 'Charts do not connect across gaps. Cumulative energy and precipitation include recorded intervals only. A full energy budget cannot be calculated across gaps.', '낙하 입자와 미처리 공급 포함. 표면 모델 부동소수점 잔차.': 'Includes falling particles and pending input. Floating-point residual from the surface model.', '표면 엔탈피에서 실제 적분된 네 에너지 채널의 합을 뺀 잔차.': 'Residual after subtracting the four integrated energy channels from surface enthalpy.', '기준 대비 변화': 'Change from baseline', '개 관측': 'observations', '시간': 'Time', '상태': 'Status', '자료 없음': 'No data',
  'CSV 기록': 'CSV history', '관측': 'Observation', '깊이별': 'by depth', '달성': 'Complete', '조작 방법': 'Controls', '도구': 'Tools', '도구 패널 접기': 'Collapse tools panel', '도구 패널 펼치기': 'Expand tools panel', '관측 패널 접기': 'Collapse observation panel', '관측 패널 펼치기': 'Expand observation panel', '실험 도구': 'Tools', '대시보드': 'Dashboard', '패널': 'panel', '접기': 'Collapse', '펼치기': 'Expand', '오버뷰': 'Overview', '확인': 'OK',
  '저장 데이터가 최대 크기(64MB)를 넘었습니다.': 'Save data exceeds the 64 MB limit.', '압축한 저장 데이터가 최대 크기(20MB)를 넘었습니다.': 'Compressed save data exceeds the 20 MB limit.', '클라우드 저장본이 너무 큽니다.': 'Cloud save is too large.', '클라우드 저장본의 형식이 맞지 않습니다.': 'Cloud save has an invalid format.', '클라우드 연결 시간이 초과되었습니다.': 'Cloud connection timed out.', '계정이 변경되었습니다. 다시 로그인하세요.': 'The account changed. Sign in again.', '클라우드 저장 정보를 읽지 못했습니다.': 'Could not read cloud save information.', '클라우드 저장본의 일부를 읽지 못했습니다. 다시 불러오세요.': 'Some cloud save data could not be read. Reload it.', '클라우드 저장본의 크기가 맞지 않습니다.': 'Cloud save has an invalid size.', '완전한 저장본만 업로드할 수 있습니다.': 'Only complete saves can be uploaded.', '다른 기기에서 저장한 진행 상황이 있습니다. 사용할 저장본을 선택하세요.': 'A save from another device is available. Choose which save to use.',
  '구름 · 물방울과 얼음': 'Clouds · droplets and ice', '소금 · 고체와 용액': 'Salt · solid and dissolved', '총 질량': 'Total mass', '표면 · 대기': 'Surface · atmosphere', '낙하 · 투입 대기': 'Falling · pending input', '지형 고체': 'Solid terrain', '액체 · 용융체': 'Liquid · molten material', '표면 얼음': 'Surface ice', '구름 응축물': 'Cloud condensate', '생물 총량': 'Total biomass', '평균 온도': 'Mean temperature', '최저 온도': 'Minimum temperature', '최고 온도': 'Maximum temperature', '온도 중앙값': 'Median temperature', '총 엔탈피': 'Total enthalpy', '누적 비': 'Cumulative rain', '누적 눈': 'Cumulative snow', '구름 셀 비율': 'Cloud cell fraction', '비 셀 비율': 'Rain cell fraction', '눈 셀 비율': 'Snow cell fraction', '표면 평균 압력': 'Mean surface pressure', '몰 수 가중 평균': 'Mole-weighted mean', '스케일 높이': 'Scale height', '0.01 atm 경계': '0.01 atm boundary', '최소 결합 매개변수': 'Minimum binding parameter', '질소 질량': 'Nitrogen mass', '메탄 질량': 'Methane mass', 'CO₂ 질량': 'CO₂ mass', '질소 몰 분율': 'Nitrogen mole fraction', '메탄 몰 분율': 'Methane mole fraction', '이산화탄소 몰 분율': 'Carbon dioxide mole fraction', '수증기 몰 분율': 'Water vapor mole fraction', '식생 셀 비율': 'Vegetation cell fraction', '외부 공급': 'External supply', '인벤토리 투입': 'Inventory input', '깎기 배출': 'Removed', '인벤토리 회수': 'Inventory collection', '우주 탈출': 'Escape to space', '환경 열교환': 'Environmental heat exchange', '명령 · 공급 · 충돌': 'Tools · supply · impact', '탈출 에너지': 'Escape energy', '수치 보정': 'Numerical correction', '표면 셀의 산술 평균': 'Arithmetic mean of surface cells', '0°C 기준 현열 + 모델 상 에너지. 기반 열용량 포함.': 'Sensible heat relative to 0°C plus modeled phase energy. Includes bedrock heat capacity.', '게임 기준 기체 컬럼 질량과 중력으로 환산': 'Converted from game-scale gas column mass and gravity', '식생 + 초식·포식 생물 + 휴면 씨앗 질량. 씨앗 분산 지수는 질량에 포함하지 않습니다.': 'Vegetation, herbivores, carnivores, and dormant seed mass. Seed dispersal index is not included.', '등온 구면 근사 · 기준 반경 1,000 km. 유한 경계가 없으면 —': 'Isothermal spherical approximation · reference radius 1,000 km. — if no finite boundary exists', '광학 깊이 > 0.1인 셀 / 전체 셀': 'Cells with optical depth > 0.1 / all cells', '직전 물리 단계에서 강수 > 10⁻⁶ kg인 셀 / 전체 셀': 'Cells with >10⁻⁶ kg precipitation in the previous physics step / all cells', '성공': 'Success', '이름 글자 수': 'Name character count', '재료 붓기 · ': 'Pour material · ', ' · 다시 눌러 해제': ' · select again to stop', '유기물을 뿌려보세요.': 'Try adding organic matter.', '발견 기록 ': 'Discovery log ', '목표 속도 기준 · ': 'Target speed baseline · ', '배속 낮추기 · ': 'Decrease simulation speed · ', '가장 느린 배속': 'Slowest simulation speed', '배속 높이기 · ': 'Increase simulation speed · ', '가장 빠른 배속': 'Fastest simulation speed', '행성 이름을 입력하세요.': 'Enter a planet name.', '0 또는 0.3~18 °/분으로 입력하세요.': 'Enter 0 or 0.3–18° per minute.', '절단면 회전 조이스틱': 'Section rotation joystick', '단면 이동 조이스틱': 'Section pan joystick', '핀으로 고정한 지점': 'Pinned location', '행성 01': 'Planet 01', '탐사 완료 · ': 'Expedition complete · ', '선택 재료 · ': 'Selected material · ', '고정 해제': 'Unpin', '빠른 선택에 고정': 'Pin to quick selection', '행성의 물질량': 'Planet inventory',
};

const finalUiTranslations: Record<string, string> = {
  '저장된 항성계를 읽지 못했습니다. 기존 데이터는 보존됩니다.': 'Could not read the saved star system. Existing data has been preserved.',
  '850°C 이상에서 점토가 소성됩니다.': 'Clay fires above 850°C.',
  '염수는 담수보다 더 차가워야 얼어요.': 'Brine must be colder than fresh water to freeze.',
  '표면의 물질을 조금씩 제거합니다.': 'Gradually remove material from the surface.',
  '회수한 물질은 모든 행성에서 함께 쓸 수 있어요.': 'Collected materials can be used on any planet.',
  '운철 36kg이 들어오고, 충돌 지형과 열이 남습니다.': 'Adds 36 kg of iron meteorite, impact terrain, and heat.',
  '클릭하면 핀 방향으로 시점이 이동합니다.': 'Click to center the view on the pinned location.',
  '기체 저온 응축': 'low-temperature gas condensation', '용융 소금': 'molten salt', '금속 액상': 'liquid metal',
  '조성별 암석 용융': 'composition-dependent rock melting', '조성별 세라믹 용융': 'composition-dependent ceramic melting',
  '이산화탄소: 고압 응축 모델 범위 밖': 'Carbon dioxide: outside the high-pressure condensation model range',
  '유한 경계 없음': 'No finite boundary', '약한 결합 · 가속 손실 근사': 'Weak binding · accelerated-loss approximation',
  '전이 영역 · 가속 손실 근사': 'Transition region · accelerated-loss approximation', '결합 강함 · 가속 손실 근사': 'Strong binding · accelerated-loss approximation',
  '0.01atm 이하의 기체는 외곽선을 표시하지 않습니다.': 'Gas below 0.01 atm is not shown in the outline.',
  '1000km 기준 반경의 등온 구면 근사입니다. 화면 높이는 압축합니다.': 'Isothermal spherical approximation at a 1,000 km reference radius. Display height is compressed.',
  '지역별 구름': 'Regional cloud cover', '적은 구름': 'Less cloud', '많은 구름': 'More cloud',
  '비교 화면을 준비하지 못했습니다. 새로고침해 주세요.': 'Could not prepare the comparison view. Please reload.',
  '기후 저장 상태가 올바르지 않습니다.': 'Climate save data is invalid.', 'GPU 연결이 종료됐습니다.': 'GPU connection was lost.',
  '저장된 물질량이 반올림 오차 범위를 벗어났습니다.': 'Saved material totals exceed the rounding tolerance.',
  '다른 창에서 저장소를 사용 중입니다.': 'Storage is in use by another window.', '저장된 행성 형식이 현재 버전과 맞지 않습니다.': 'The saved planet format is incompatible with this version.',
  '계산 상태가 저장 형식과 맞지 않습니다.': 'Simulation state does not match the save format.',
  'Sandsphere에서 내보낸 시계열 CSV를 선택하세요.': 'Choose a time-series CSV exported from Sandsphere.',
  'CSV에 최초 관측 기준값이 없어 복원할 수 없습니다.': 'The CSV has no initial observation baseline to restore.',
  'CSV의 관측 공백 정보가 잘못되었습니다.': 'The CSV contains invalid observation gap data.',
  '이미 불러온 기록이거나 현재 기록과 시간이 겹칩니다. 현재 기준보다 이전에 끝나는 CSV를 선택하세요.': 'This history is already imported or overlaps the current timeline. Choose a CSV that ends before the current baseline.',
  '빠르게 회전하고 놓으면 멈춥니다. 방향키로도 조작할 수 있습니다.': 'Drag farther to rotate faster; release to stop. Arrow keys also work.',
  '상승 공기 온도가 열역학 모델 범위를 벗어났습니다.': 'Rising-air temperature is outside the thermodynamic model range.',
  '단파 광학 두께 적분이 수렴하지 않았습니다.': 'Shortwave optical-depth integration did not converge.',
  '복사 밴드 가중치가 올바르지 않습니다.': 'Radiation-band weights are invalid.',
  '대기 수평 CFL 한계를 넘었습니다.': 'Atmospheric horizontal CFL limit exceeded.',
  '대기 수직 CFL 한계를 넘었습니다.': 'Atmospheric vertical CFL limit exceeded.',
  '지정한 기후 경계 조건이 올바르지 않습니다.': 'The specified climate boundary conditions are invalid.',
  '대기 온도가 모델 범위를 벗어났습니다.': 'Atmospheric temperature is outside the model range.',
  '상승 공기 온도': 'Rising-air temperature',
  '단파 광학 두께': 'Shortwave optical depth', '대기 적분 간격은 0–60초 범위여야 합니다.': 'Atmospheric integration step must be between 0 and 60 seconds.',
  'CSV 파일은 8 MB 이하여야 합니다.': 'CSV files must be 8 MB or smaller.',
  '선택한 행성의 관측 기록이 없습니다.': 'No observation history for the selected planet.',
  '초기': 'Initial', '대시보드 기록': 'dashboard history',
  '구름 3안 비교': 'Compare three cloud styles', '구름 표현 비교': 'Cloud appearance comparison', '같은 구름량 · 같은 조명 · 시점 동기화': 'Same cloud amount · same lighting · synchronized views', '언어': 'Language', '시점 초기화': 'Reset view', '비교할 구름 분포': 'Cloud cover to compare', '내 행성': 'My planet', '대기 함께 보기': 'Show atmosphere', '세 안 함께 보기': 'Show all three', '얇고 흐르는 층운': 'Thin, flowing stratus', '낮은 두께 · 넓은 연결 · 옅은 음영': 'Low profile · broad connections · soft shading', '둥글고 포근한 적운': 'Rounded, soft cumulus', '완만한 볼륨 · 부드러운 덩어리': 'Gentle volume · soft forms', '단정한 그래픽 구름': 'Clean graphic clouds', '얕은 두께 · 또렷한 윤곽 · 균일한 음영': 'Shallow profile · crisp edges · even shading', '크게 보기': 'View larger', '세 가지 안을 준비하고 있습니다…': 'Preparing the three styles…', '드래그 회전 · 휠 확대 · 원본 데이터 유지': 'Drag to rotate · scroll to zoom · source data preserved', '층운': 'Stratus', '적운': 'Cumulus', '그래픽 구름': 'Graphic clouds', '계산 정지': 'Simulation paused', '구름 물·얼음': 'Cloud water and ice',
};

const reviewedTranslations: Record<string, string> = {
  '드래그로 모든 시점 회전, 휠로 확대': 'Drag to rotate all views; scroll to zoom',
  'ΔM − (공급 + 투입 − 배출 − 회수 − 탈출)': 'ΔM − (supply + input − removal − collection − escape)',
  '표면 셀 온도 분포': 'Surface cell temperature distribution',
  '용융 실리카': 'Molten silica', '용존 소금': 'Dissolved salt',
  '온도 P10': 'Temperature P10', '온도 P90': 'Temperature P90', 'H₂O 총량': 'Total H₂O',
  '구름 물방울': 'Cloud droplets', '구름 얼음': 'Cloud ice',
  '비 강수율': 'Rain rate', '눈 강수율': 'Snow rate',
  '식생 > 0.01 kg인 셀 / 전체 셀': 'Cells with vegetation > 0.01 kg / all cells',
  "씨앗": "Seeds",
  "구름": "Clouds",
  "비": "Rain",
  "눈": "Snow",
  "구간 너비는 층 두께, 구간 안의 색 비율은 질량 비율입니다. 고체층은 균일한 혼합물입니다.": "Band width represents layer thickness; the color proportions within each band represent mass fractions. Solid layers are uniform mixtures.",
  "지표와 11개 대기층의 온도를 따로 계산합니다. 기류는 질량·운동량·열을 운반하고 상승·하강 교환에는 중력 위치에너지와 단열 냉각을 반영합니다. 수증기·CO₂·메탄·오존의 분광 적외선 전달, 대기의 햇빛 흡수, 구름과 지표의 반복 반사를 계산합니다. 습윤 상승 공기는 응축 잠열과 주변 공기 혼입에 따른 부력을 반영합니다. 아래 복사 평형은 현재 대기 온도를 고정했을 때의 지표 값입니다. 전체 기후의 미래 온도 예측은 아닙니다. 에너지 장부에는 현열·잠열·위치·수평 운동에너지가 포함됩니다. 지구형 기체 분광 표와 축약 단파 전달을 사용하며 심해·비정역학 대류·에어로졸 예측은 생략합니다. 관측 기후와의 정량 일치는 아직 검증되지 않았습니다.": "Surface and atmospheric temperatures are calculated separately across 11 layers. Airflow transports mass, momentum, and heat; upward and downward exchange includes gravitational potential energy and adiabatic cooling. The model calculates spectral infrared transfer by water vapor, CO₂, methane, and ozone, absorption of sunlight by the atmosphere, and repeated reflections between clouds and the surface. Moist rising air includes buoyancy from condensation heat and entrainment of surrounding air. The radiative balance below is a surface value with atmospheric temperatures held fixed, not a prediction of future climate. The energy budget includes sensible, latent, potential, and horizontal kinetic energy. Earth-like gas spectra and reduced shortwave transfer are used. Deep oceans, non-hydrostatic convection, and aerosol forecasts are omitted. Quantitative agreement with observed climate has not yet been validated.",
  "조성은 분자 수 비율입니다. 기준 질소 기둥 0.3kg·중력 1×를 1atm으로 보정한 게임 대기입니다. 이 지점의 기체량·중력이 비등 기준과 수증기 분압에 연결됩니다. 중력이 약하거나 뜨거우면 기체가 우주로 빠져나갑니다. 1000km 기준 반경에서 반경에 따른 중력 변화를 반영합니다. 0.01atm 경계가 성립하지 않거나 반경의 25%를 넘으면 표시 상한을 사용합니다. 탈출은 외기권 해석이 아닌 가속 손실 근사입니다. 높이는 화면에서 압축합니다. 메탄의 빛 흡수와 연무를 색으로 근사합니다.": "Composition is shown as molecular fractions. This game atmosphere calibrates a 0.3 kg nitrogen column at 1× gravity to 1 atm. Local gas mass and gravity affect the boiling point and water vapor partial pressure. Gas escapes into space under weak gravity or high temperatures. Gravity varies with radius from a reference radius of 1,000 km. A display cap is used when the 0.01 atm boundary does not exist or exceeds 25% of the radius. Escape uses an accelerated-loss approximation rather than an exosphere calculation. Display heights are compressed. Color approximates methane absorption and haze.",
  "궤도 거리는 생성 후 고정됩니다. 공전 주기는 행성 시간으로 표시합니다.": "Orbital distance is fixed after creation. Orbital periods are shown in planet time.",
  "지표와 11개 대기층은 각각 온도를 저장합니다. 응축물이 가장 많은 층의 온도·습도를 표시하며, 구름이 없으면 최하층을 표시합니다. 상승하는 공기의 단열 냉각과 응결 잠열을 계산합니다. 기류는 m/s, 해류는 평균 셀 간격/행성분으로 표시합니다.": "The surface and 11 atmospheric layers store separate temperatures. Temperature and humidity are shown for the layer with the most condensate, or the lowest layer when there are no clouds. Rising air includes adiabatic cooling and condensation heat. Airflow is shown in m/s; ocean currents use average cell spacing per planet minute.",
  "구름은 실제 물방울·얼음의 양으로 표시합니다. 습도와 기류·지형 상승에 따라 응결하거나 재증발하고, 바람에 이동하며 비·눈을 만듭니다. 작은 구름은 구름량 지도에서 확인하세요. 표시를 꺼도 계산은 계속됩니다. 강수 지도는 지표에 도달한 양을 표시하며 정지 중 마지막 분포를 유지합니다.": "Clouds show the actual amounts of water droplets and ice. Humidity, airflow, and terrain-driven ascent cause condensation or evaporation; wind carries clouds, which produce rain and snow. Check the cloud map for small clouds. Calculations continue when the display is hidden. The precipitation map shows amounts reaching the surface and retains the last distribution while paused.",
  "대기는 11개 층으로 나뉘며 각 층에 온도·수증기·물방울·얼음을 저장합니다. 부력으로 상승한 공기는 단열 냉각되고, 과포화 수증기는 잠열을 방출하며 응결합니다. 얼음과 액체는 0°C 주변의 혼합 상평형으로 계산합니다. 강수는 층을 따라 내려오며 건조한 층에서 다시 증발할 수 있습니다. 육지·바다·낮·밤으로 구름 생성을 제한하지 않습니다. 빗방울의 개별 궤적은 계산하지 않습니다.": "The atmosphere has 11 layers, each storing temperature, water vapor, droplets, and ice. Buoyant rising air cools adiabatically, and supersaturated vapor condenses while releasing latent heat. Ice and liquid use mixed-phase equilibrium around 0°C. Precipitation falls through the layers and can evaporate in dry layers. Cloud formation is not restricted by land, sea, day, or night. Individual raindrop trajectories are not calculated.",
  "화면만 고정합니다. 자전·공전·날씨 계산은 계속됩니다.": "Only the view is held still. Rotation, orbit, and weather calculations continue.",
  "행성 시간 1분에 도는 각도입니다. 0이면 실제 자전을 멈춥니다.": "The angle rotated in one planet minute. Set to 0 to stop the actual rotation.",
  "실제 자전 속도 직접 입력": "Enter rotation speed",
  "°/분": "°/min",
  "자전축 기울기 직접 입력": "Enter axial tilt",
  "0~180°, 0.5° 단위로 입력하세요.": "Enter 0–180° in steps of 0.5°.",
  "행성 시간으로 표시합니다. 동기 자전 표시에서 공전 주기와 맞춰 낮과 밤을 고정합니다. 자전축은 0°로 맞춰지고, 표시를 벗어나면 일반 자전으로 바뀝니다.": "Shown in planet time. Synchronous rotation matches the orbital period to keep day and night fixed. Axial tilt is set to 0°. Leaving this setting restores normal rotation.",
  "자전 주기 직접 입력": "Enter rotation period",
  "분": "min",
  "20~1,200분, 1분 단위로 입력하세요.": "Enter 20–1,200 minutes in steps of one minute.",
  "드래그로 절단면을 두 축으로 돌립니다. 이동 버튼 또는 Shift+드래그로 화면을 옮기고 휠로 확대합니다. 선택 지점 주변의 셀을 가로로 펼쳐 보여줍니다. 기반암은 숨기고 그 위의 표면 혼합물과 물을 표시합니다. 범위는 대략적인 셀 간격 기준입니다.": "Drag to rotate the section on two axes. Use the pan button or Shift+drag to move the view, and scroll to zoom. Cells around the selected location are laid out horizontally. Bedrock is hidden; surface mixtures and water above it are shown. The range uses approximate cell spacing.",
  "1×는 현실 1초에 행성 시간 1분을 진행하는 목표 속도입니다. 계산 성능에 따라 실제 속도는 달라집니다.": "1× targets one minute of planet time per real second. Actual speed depends on computing performance.",
  "Scientific Reports · 젖은 모래 연구 ↗": "Scientific Reports · Wet sand research ↗",
  "USGS · 물과 증기압 ↗": "USGS · Water and vapor pressure ↗",
  "NWS · 구름의 발달과 강수 ↗": "NWS · Cloud development and precipitation ↗",
  "NSIDC · 해빙의 과학 ↗": "NSIDC · The science of sea ice ↗",
  "IUPAC–NIST · 염화나트륨 용해도 ↗": "IUPAC–NIST · Sodium chloride solubility ↗",
  "NASA · 베누의 증발 광물 ↗": "NASA · Evaporite minerals on Bennu ↗",
  "Journal of Archaeological Science · 점토 구조 변화 ↗": "Journal of Archaeological Science · Clay structure changes ↗",
  "Corning · 유리 제조 ↗": "Corning · Glass manufacturing ↗",
  "NASA · 행성 대기와 스케일 높이 ↗": "NASA · Planetary atmospheres and scale height ↗",
  "물질을 골라 행성에 부어보세요.": "Choose a material and pour it onto the planet.",
  "확대 · 축소": "Zoom in · Zoom out",
  "터치": "Touch",
  "물질 · 작업 도구": "Materials · Tools",
  "생성물 재사용": "Reuse products",
  "행성 이동": "Travel between planets",
  "시간 · 시점": "Time · View",
  "공전 · 자전": "Orbit · Rotation",
  "행성 생성": "Planet creation",
  "자연 현상": "Natural phenomena",
  "선택한 물질을 중심으로 지형과 표면층을 만듭니다. 얼음과 물의 상태는 배치한 궤도의 온도에 따라 변해요.": "Terrain and surface layers are built around the selected material. Ice and water change state according to the temperature of the chosen orbit.",
  "궤도 거리는 생성 후 고정됩니다. 거리가 두 배면 에너지는 ¼. 온도와 시간은 게임용 근사값입니다.": "Orbital distance is fixed after creation. Doubling the distance reduces energy to ¼. Temperature and time are approximations for gameplay.",
  "휴면 씨앗과 소량의 탄소원을 포함합니다. 물·빛·온도가 맞는 모래나 점토에서도 식생이 정착합니다.": "Includes dormant seeds and a small carbon supply. Vegetation can establish on sand or clay when water, light, and temperature are suitable.",
  "기존 행성을 보존하고 새 행성을 추가합니다. 최대 4개까지 함께 실험할 수 있어요.": "Adds a new planet while preserving existing planets. You can experiment with up to four planets together.",
  "행성 편집 모드": "Planet editing mode",
  "드래그로 절단면을 두 축으로 회전": "Drag to rotate the section on two axes",
  "드래그로 단면 화면 이동 · Shift로도 이동": "Drag to pan the section · Shift also pans",
  "단면 표시 범위": "Section display range",
  "현재 관찰 범위를 화면에 맞춤": "Fit the current observation range to the view",
  "입자 칸은 기존 셀의 실제 고체 혼합 비율을 보여줍니다. 세로 확대는 표시 배율이며 물리 계산은 동일합니다.": "Particle cells show the actual solid mixture fractions of existing cells. Vertical zoom changes display scale; the physics calculations stay the same.",
  "관찰 핀으로 시점 이동": "Center view on observation pin",
  "이 핀 방향으로 시점 이동": "Center view in this pin’s direction",
  "관찰 핀 삭제": "Remove observation pin",
  "화면 밖 태양 방향": "Direction to off-screen sun",
  "태양 방향 · 화면 밖": "Sun direction · Off screen",
  "활성 레이어 범례": "Active layer legend",
  "행성분당 강수량이 많을수록 진하게 표시": "Darker shading indicates more precipitation per planet minute",
  "대기 표시 / 숨김": "Show / hide atmosphere",
  "구름 표시 / 숨김 · 숨겨도 기후 계산은 계속됩니다.": "Show / hide clouds · Climate calculations continue when hidden.",
  "자전축 표시 / 숨김": "Show / hide rotation axis",
  "강수 지역 표시 / 숨김 · 강수량이 많을수록 진하게 표시하며, 일시정지 시 마지막 분포를 유지합니다.": "Show / hide precipitation regions · More precipitation is shaded darker; the last distribution remains while paused.",
  "물질과 도구": "Materials and tools",
  "실험 도구 닫기": "Close tools",
  "관측 정보 닫기": "Close observation information",
  "현재 관측 지점": "Current observation location",
  "관측 지점의 깊이별 물질 분포": "Material depth profile at the observation location",
  "최근 온도 변화. 현재 지점의 온도 범위에 맞춰 세로 축을 조정합니다.": "Recent temperature changes. The vertical axis adjusts to the temperature range at the current location.",
  "행성 조정 접기": "Collapse planet adjustments",
  "행성의 화면 회전만 고정 / 재개": "Hold / resume planet view rotation",
  "실제 자전 각도": "Actual rotation angle",
  "구면에서 절단선과 셀 범위 선택": "Select a section line and cell range on the globe",
  "일시 정지 / 재생": "Pause / play",
  "행성 시간과 실제 진행 속도": "Planet time and actual simulation speed",
  "실험은 이 브라우저에 자동으로 이어집니다.": "Your experiment is saved automatically in this browser.",
  "첫 실험 안내 닫기": "Close first experiment guide",
  "조작 방법 닫기": "Close controls guide",
  "행성 만들기 닫기": "Close planet creation",
  "인벤토리 분류": "Inventory categories",
  "모드 선택 닫기": "Close mode selection",
  "알림 센터 닫기": "Close notifications",
  "알림 필터": "Notification filters",
  "게임 표면층 모델. kg는 정규화된 게임 질량, kJ는 보정된 모델 에너지입니다. 실제 천체의 물리량이 아닙니다.": "Game surface-layer model. kg represents normalized game mass; kJ represents calibrated model energy. These are not physical quantities for a real celestial body.",
  "분석할 행성": "Planet to analyze",
  "kg/행성분": "kg/planet min",
  "행성분당": "per planet minute",
  "생물 표본": "Life samples",
  "단면 조정": "Section adjustments",
  "배속 기준": "Simulation speed baseline",
  "화면 회전 고정": "Hold view rotation",
  "실제 자전 속도": "Actual rotation speed",
  "동기 자전": "Synchronous rotation",
  "대기 계산": "Atmosphere model",
  "궤도": "Orbit",
  "지점 기후": "Local climate",
  "날씨와 지도": "Weather and maps"
};

const translationPatterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^([A-C]) (층운|적운|그래픽 구름)$/, m => `${m[1]} ${translate(m[2])}`],
  [/^발견 기록 (\d+)$/, m => `Discovery log ${m[1]}`],
  [/^관찰 지도: (.+)$/, m => `Observation map: ${translate(m[1])}`],
  [/^(.+) 빠른 선택에서 제외$/, m => `${translate(m[1])} · Remove from quick selection`],
  [/^(.+) 설명$/, m => `${translate(m[1])} help`],
  [/^(.+) 발견$/, m => `${translate(m[1])} discovered`],
  [/^([\d,.]+) kg\/행성분$/, m => `${m[1]} kg/planet min`],
  [/^([\d,.]+)시간$/, m => `${m[1]} h`],
  [/^(.+) ↗$/, m => `${translate(m[1])} ↗`],
  [/^(\d+)셀$/, m => `${m[1]} ${m[1] === '1' ? 'cell' : 'cells'}`],
  [/^약 (\d+)셀$/, m => `about ${m[1]} cells`],
  [/^(\d+)곳$/, m => `${m[1]} locations`],
  [/^비 (\d+)곳$/, m => `${m[1]} rainy cells`],
  [/^눈 (\d+)곳$/, m => `${m[1]} snowy cells`],
  [/^(\d+)개 관측 · (기준 대비 변화|실제값)$/, m => `${m[1]} observations · ${m[2] === '실제값' ? 'absolute values' : 'change from baseline'}`],
  [/^알림 센터 · 읽지 않은 알림 (\d+)개$/, m => `Notifications · ${m[1]} unread`],
  [/^(\d+)개 안 읽음$/, m => `${m[1]} unread`],
  [/^행성 시간 · 기준 (.+) · 현재 (.+) · ([\d,]+) 표본$/, m => `Planet time · baseline ${m[1]} · current ${m[2]} · ${m[3]} samples`],
  [/^행성 (\d+)$/, m => `Planet ${m[1]}`],
  [/^행성 (\d+)개까지 만들 수 있습니다\.$/, m => `You can create up to ${m[1]} planets.`],
  [/^행성 (.+) · 행성 전환$/, m => `${m[1]} · Switch planet`],
  [/^(.+) 이름을 저장했습니다\.$/, m => `${m[1]} name saved.`],
  [/^(.+)로 이동$/, m => `Go to ${m[1]}`],
  [/^(.+) · 공전 (.+)$/, m => `${m[1]} · Orbital period ${m[2]}`],
  [/^약 (\d+)셀$/, m => `about ${m[1]} cells`],
  [/^([\d.]+) AU · (-?[\d.]+)°C · (일시 정지|변화 중)$/, m => `${m[1]} AU · ${m[2]}°C · ${m[3] === '일시 정지' ? 'Paused' : 'Changing'}`],
  [/^(\d+(?:\.\d+)?)분$/, m => `${m[1]} min`],
  [/^표시 상한 ([\d.]+) km$/, m => `Display cap ${m[1]} km`],
  [/^(.+): (.+) 모델 범위 밖$/, m => `${translate(m[1])}: ${translate(m[2])} is outside the model range`],
  [/^(질소|메탄|이산화탄소|수증기) ([\d.]+)%$/, m => `${translate(m[1])} ${m[2]}%`],
  [/^기체 조성: (.+)$/, m => `Gas composition: ${m[1].split(', ').map(item => item.replace(/^(질소|메탄|이산화탄소|수증기) ([\d.]+)%$/, (_all, gas, percent) => `${translate(gas)} ${percent}%`)).join(', ')}`],
  [/^행성은 최대 (\d+)개까지 만들 수 있습니다\.$/, m => `You can create up to ${m[1]} planets.`],
  [/^알림 센터 · 읽지 않은 알림 (\d+)개$/, m => `Notifications · ${m[1]} unread`],
  [/^관찰 핀 · (반대편|화면 밖) · 이 지점으로 시점 이동$/, m => `Observation pin · ${translate(m[1])} · Center view here`],
  [/^핀으로 고정한 지점 · (반대편|화면 밖) \(가장자리에 방향 표시\)$/, m => `Pinned location · ${translate(m[1])} (direction shown at edge)`],
  [/^(.+) · 공전 (.+)$/, m => `${m[1]} · Orbital period ${m[2]}`],
  [/^(.+) 이름을 저장했습니다\.$/, m => `${m[1]} name saved.`],
  [/^클라우드에 저장했습니다\. · (.+)$/, m => `Saved to cloud · ${m[1]}`],
  [/^목표 속도 기준 · (.+)$/, m => `Target speed baseline · ${m[1]}`],
  [/^CSV (\d+)번째 관측값의 열 수가 맞지 않습니다\.$/, m => `The number of columns in CSV observation ${m[1]} is incorrect.`],
  [/^CSV (\d+)번째 관측값을 읽을 수 없습니다\.$/, m => `Could not read CSV observation ${m[1]}.`],
  [/^등온 구면식으로 0\.01atm 경계를 찾을 수 없습니다\. 외곽선은 ([\d.]+)km 표시 상한입니다\.$/, m => `The isothermal spherical model cannot find the 0.01 atm boundary. The outline is capped at ${m[1]} km.`],
  [/^계산 높이가 기준 반경의 25%를 넘습니다\. 외곽선은 ([\d.]+)km 표시 상한입니다\.$/, m => `Calculated height exceeds 25% of the reference radius. The outline is capped at ${m[1]} km.`],
  [/^클라우드에 저장했습니다\. · (.+)$/, m => `Saved to cloud · ${m[1]}`],
  [/^탐사 완료 · (.+)$/, m => `Expedition complete · ${m[1].split(' · ').map(name => translate(name)).join(' · ')}`],
  [/^고정된 관찰 지점 · (반대편|화면 밖)$/, m => `Pinned observation point · ${translate(m[1])}`],
  [/^핀 고정 · (반대편|화면 밖)$/, m => `Pinned · ${translate(m[1])}`],
  [/^(-?[\d.]+)°C · 삼중점 이하 근사$/, m => `${m[1]}°C · below triple-point approximation`],
  [/^(-?[\d.]+)°C · 180°C 상한 근사$/, m => `${m[1]}°C · 180°C upper-limit approximation`],
  [/^({…})$/, m => m[1]],
];

let locale: Locale = 'ko';
type LocalizedValue = {source: string; localized: string};
const originalText = new WeakMap<Text, LocalizedValue>();
const originalAttributes = new WeakMap<Element, Map<string, {source: string; localized: string}>>();
const contextualOriginals = new WeakMap<Element, LocalizedValue>();
const translate = (value: string) => {
  if (locale !== 'en' || !value.trim()) return value;
  const trimmed = value.trim();
  let replacement = reviewedTranslations[trimmed] ?? translations[trimmed] ?? additionalTranslations[trimmed] ?? finalUiTranslations[trimmed];
  if (replacement === undefined) {
    for (const [pattern, render] of translationPatterns) {
      const match = trimmed.match(pattern);
      if (match) { replacement = render(match); break; }
    }
  }
  if (replacement === undefined && trimmed.includes(' · ')) {
    replacement = trimmed.split(' · ').map(part => translate(part)).join(' · ');
  }
  if (replacement === undefined) return value;
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  return `${leading}${replacement}${trailing}`;
};

export function translatePhrase(value: string, contextKey?: string): string {
  if (locale !== 'en') return value;
  return contextKey ? (contextualTranslations[contextKey] ?? translate(value)) : translate(value);
}

function localizeNode(node: Node) {
  const owner = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  if (owner?.closest('[translate="no"], script, style, code, textarea')) return;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    let record = originalText.get(text);
    if (!record || text.data !== record.localized) {
      record = {source: text.data, localized: text.data};
      originalText.set(text, record);
    }
    const localized = translate(record.source);
    record.localized = localized;
    if (text.data !== localized) text.data = localized;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  for (const name of ['aria-label', 'title', 'placeholder', 'aria-valuetext']) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    let values = originalAttributes.get(element);
    if (!values) originalAttributes.set(element, values = new Map());
    let record = values.get(name);
    if (!record || value !== record.localized) record = {source: value, localized: value};
    const localized = translate(record.source);
    record.localized = localized;
    values.set(name, record);
    if (value !== localized) element.setAttribute(name, localized);
  }
  const contextKey = element.getAttribute('data-i18n-key');
  if (contextKey) {
    const value = element.textContent ?? '';
    let record = contextualOriginals.get(element);
    if (!record || value !== record.localized) {
      record = {source: value, localized: value};
      contextualOriginals.set(element, record);
    }
    const localized = locale === 'en' ? (contextualTranslations[contextKey] ?? translate(record.source)) : record.source;
    record.localized = localized;
    if (value !== localized) element.textContent = localized;
    return;
  }
  for (const child of element.childNodes) localizeNode(child);
}

export interface LocalizationOptions {
  selector?: string;
  root?: string;
  title?: {ko: string; en: string};
  description?: {ko: string; en: string};
}

function applyLocale(next: Locale, selector: HTMLSelectElement, root: Element, options: LocalizationOptions) {
  locale = next;
  document.documentElement.lang = locale;
  document.title = options.title?.[locale] ?? (locale === 'en' ? 'Sandsphere — A Small Planet Lab' : 'Sandsphere — 작은 행성의 실험실');
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (meta) meta.content = options.description?.[locale] ?? (locale === 'en'
    ? 'Pour materials, change temperatures, and discover natural phenomena in a small planet laboratory.'
    : '물질을 붓고, 온도를 바꾸고, 작은 행성에서 자연현상을 발견하는 Sandsphere 실험실.');
  try { localStorage.setItem('sandsphere-language', locale); } catch { /* Language still applies for this session. */ }
  localizeNode(root);
  selector.value = locale;
  window.dispatchEvent(new Event('sandsphere-language-change'));
}

export function setupLocalization(options: LocalizationOptions = {}) {
  const selector = document.querySelector<HTMLSelectElement>(options.selector ?? '#settings-language');
  const root = document.querySelector(options.root ?? '#app');
  if (!selector || !root) return;
  const onChange = () => applyLocale(selector.value === 'en' ? 'en' : 'ko', selector, root, options);
  selector.addEventListener('change', onChange);
  let saved: string | null = null;
  try { saved = localStorage.getItem('sandsphere-language'); } catch { /* Language preference is optional. */ }
  const preferred = saved === 'ko' || saved === 'en' ? saved : (navigator.languages ?? [navigator.language]).find(language => /^(ko|en)(-|$)/i.test(language))?.toLowerCase().startsWith('en') ? 'en' : 'ko';
  applyLocale(preferred, selector, root, options);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') localizeNode(record.target.parentElement?.hasAttribute('data-i18n-key') ? record.target.parentElement : record.target);
      else if (record.type === 'attributes' || (record.target as Element).hasAttribute?.('data-i18n-key')) localizeNode(record.target);
      else for (const node of record.addedNodes) localizeNode(node);
    }
  });
  observer.observe(root, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder', 'aria-valuetext']});
  return () => { observer.disconnect(); selector.removeEventListener('change', onChange); };
}

export function currentLocale(): Locale { return locale; }
