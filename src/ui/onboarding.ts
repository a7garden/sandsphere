export function firstExperimentMarkup() {
  return `<section id="first-experiment" class="first-experiment" aria-labelledby="first-experiment-title" hidden>
    <span class="first-experiment-eyebrow">첫 번째 실험 · 추천 설정</span>
    <h3 id="first-experiment-title">작은 암석 행성에서 시작해요</h3>
    <p>태양에서 1 AU 떨어진 암석 행성을 만듭니다. 나중에 항성계에서 다른 행성도 만들 수 있어요.</p>
    <button type="button" id="first-experiment-create" class="create-planet">추천 설정으로 행성 만들기</button>
    <button type="button" id="first-experiment-customize" class="first-experiment-customize">재료와 궤도 직접 정하기</button>
  </section>`;
}

export function firstStepsMarkup() {
  return `<section id="first-steps" class="first-steps" aria-labelledby="first-steps-title" aria-live="polite" hidden>
    <div class="first-steps-heading"><span id="first-steps-count"></span><button type="button" id="first-steps-close" aria-label="첫 실험 안내 닫기">×</button></div>
    <h2 id="first-steps-title"></h2><p id="first-steps-copy"></p>
    <div class="first-steps-actions"><button type="button" id="first-steps-action"></button><button type="button" id="first-steps-skip">안내 닫기</button></div>
  </section>`;
}

export class FirstSteps {
  private step = 0;
  private readonly host = document.getElementById('first-steps')!;
  constructor(private readonly chooseSand: () => void) {
    document.getElementById('first-steps-close')!.addEventListener('click', () => this.close());
    document.getElementById('first-steps-skip')!.addEventListener('click', () => this.close());
    document.getElementById('first-steps-action')!.addEventListener('click', () => {
      if (this.step === 0) this.chooseSand();
      else if (this.step === 2) this.close();
    });
  }
  open() { this.step = 0; this.host.hidden = false; this.render(); }
  close() { this.host.hidden = true; }
  selectedMaterial() { if (!this.host.hidden && this.step === 0) { this.step = 1; this.render(); } }
  poured() { if (!this.host.hidden && this.step === 1) { this.step = 2; this.render(); } }
  private render() {
    const steps = [
      {title: '모래를 골라보세요', copy: '실험 도구에서 모래를 고르면 붓기 모드가 됩니다. 아래 버튼으로 바로 선택할 수도 있어요.', action: '모래 선택'},
      {title: '행성에 부어보세요', copy: '행성 표면을 누르거나 드래그해 선택한 물질을 부어보세요. 그랩을 누르면 다시 시점을 돌릴 수 있어요.', action: '행성을 눌러주세요'},
      {title: '변화를 관찰해보세요', copy: '관측 패널에서 표면의 상태를 보고, 관찰 핀으로 한 지점을 고정해보세요. 실험은 자동 저장됩니다.', action: '실험 계속하기'},
    ];
    const current = steps[this.step];
    document.getElementById('first-steps-count')!.textContent = `${this.step + 1} / ${steps.length}`;
    document.getElementById('first-steps-title')!.textContent = current.title;
    document.getElementById('first-steps-copy')!.textContent = current.copy;
    const button = document.getElementById('first-steps-action') as HTMLButtonElement;
    button.textContent = current.action;
    button.hidden = this.step === 1;
  }
}
