# 단면 설계 자료

2026년 10월 10일 요구 개정: 제품의 단면은 **같은 시뮬레이션 패널 안의 실시간 카메라 모드**다. 구형↔단면 전환 중에도 같은 세계가 진행하며, 단면에서 기존 파우더토이 렌더와 모든 도구를 지원해야 한다.

이 폴더의 `science-section.html`과 `science-section-preview.png`는 이전 그래프 시안이다. 원래 셀의 높이·온도·조성·축 단위를 확인하는 수치 자료로 보존하며, 현재 제품 화면 설계나 카메라 구현 완료를 나타내지 않는다. 시간 슬라이더는 미리 계산한 6개 기록을 선택한다.

현재 제품 명세:

- [실시간 단면 카메라와 시뮬레이션 설계](../docs/SCIENCE_SECTION_DESIGN.md)
- [카메라·절단 면·모든 렌더 레이어·도구의 연결 명세](../docs/SECTION_CAMERA_RENDERING.md)
- [감사 재검토와 개발 순서](../docs/SCIENCE_GAME_REVIEW.md)

`node design/reproduce-audit.mjs`는 기존 solver의 감사 실험을 재현한다. `node design/generate-section-preview.mjs`는 위 수치 자료를 다시 생성한다. 두 작업 모두 본 게임의 사용자 세계·공유 재고에 접근하지 않는다.

셀 상태 변화의 후속 감사는 [전체 조건 검토](../docs/CELL_STATE_SCIENCE_AUDIT.md)에 있다. `node design/reproduce-cell-conditions.mjs`는 시간 간격·상변화·소성 이력·생태·열수지 경계 실험을 실행하고 `cell-condition-evidence.json`에 조건과 소스 해시를 저장한다. 엔진 수정이나 GPU 실행 검증을 수행하는 스크립트는 아니다.
