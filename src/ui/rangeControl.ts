/** Native-input adaptation of Garden Arc's inset track, round thumb and value bubble. */
export const RANGE_THUMB_SIZE = 20;

export function updateRangeControl(input: HTMLInputElement) {
  const control = input.parentElement;
  if (!control?.classList.contains('range-control')) return;
  const min = Number(input.min || 0), max = Number(input.max || 100);
  const fraction = max > min ? Math.max(0, Math.min(1, (input.valueAsNumber - min) / (max - min))) : 0;
  const position = `${fraction * 100}%`;
  if (control.style.getPropertyValue('--range-fill') !== position) {
    control.style.setProperty('--range-fill', position);
    control.style.setProperty('--range-offset', `${fraction * RANGE_THUMB_SIZE}px`);
  }
  const output = document.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)?.querySelector('output');
  const text = input.id === 'axis-tilt' ? `${input.value}°`
    : input.id === 'spin-period' ? `${input.value}분`
    : output?.textContent || input.value;
  const bubble = control.querySelector('.range-value')!;
  if (bubble.textContent !== text) bubble.textContent = text;
}

export function setupRangeControls() {
  document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(input => {
    const control = document.createElement('div');
    control.className = 'range-control';
    control.style.setProperty('--range-thumb-size', `${RANGE_THUMB_SIZE}px`);
    input.before(control);
    control.append(input);
    const bubble = document.createElement('span');
    bubble.className = 'range-value';
    bubble.setAttribute('aria-hidden', 'true');
    control.append(bubble);
    input.addEventListener('input', () => queueMicrotask(() => updateRangeControl(input)));
    input.addEventListener('focus', () => updateRangeControl(input));
    input.addEventListener('pointerdown', () => {
      control.dataset.dragging = 'true';
      updateRangeControl(input);
    });
    const release = () => delete control.dataset.dragging;
    input.addEventListener('lostpointercapture', release);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    updateRangeControl(input);
  });
}
