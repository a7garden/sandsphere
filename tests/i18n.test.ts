// @vitest-environment happy-dom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {currentLocale, setupLocalization, translatePhrase} from '../src/ui/i18n';
import {MATERIALS, RESEARCH} from '../src/ui/content';
import {CLIMATE_LAYERS} from '../src/sim/weatherClimate';
import {METRICS} from '../src/sim/telemetry';
import {MATERIAL_SOURCES} from '../src/ui/materialSupply';
import {EXPEDITIONS} from '../src/sim/progress';

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 15));
function start(content = '', saved: string | null = 'en') {
  document.body.innerHTML = `<main id="app"><select id="settings-language"><option value="ko">한국어</option><option value="en">영어</option></select>${content}</main>`;
  if (saved !== null) localStorage.setItem('sandsphere-language', saved);
  dispose = setupLocalization();
}
async function switchTo(locale: 'ko' | 'en') {
  const select = document.querySelector<HTMLSelectElement>('#settings-language')!;
  select.value = locale;
  select.dispatchEvent(new Event('change'));
  await settle();
}
beforeEach(() => { localStorage.clear(); });
afterEach(() => { dispose?.(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('localization', () => {
  it('updates live text without restoring an earlier reading', async () => {
    start('<output id="live">1셀</output>');
    const text = document.querySelector('#live')!.firstChild as Text;
    expect(text.data).toBe('1 cell');
    text.data = '8셀';
    await settle();
    expect(text.data).toBe('8 cells');
    await switchTo('ko');
    expect(text.data).toBe('8셀');
    await switchTo('en');
    expect(text.data).toBe('8 cells');
  });

  it('localizes new content, changed attributes, and context labels in both directions', async () => {
    start('<button id="context" data-i18n-key="inventory.category.crafted" title="설정">발견</button>');
    const button = document.querySelector('#context')!;
    expect(button.textContent).toBe('Discoveries');
    expect(button.getAttribute('title')).toBe('Settings');
    button.setAttribute('title', '닫기');
    button.textContent = '발견';
    const output = document.createElement('output');
    output.textContent = '비 3곳';
    document.querySelector('#app')!.append(output);
    await settle();
    expect(button.textContent).toBe('Discoveries');
    expect(button.getAttribute('title')).toBe('Close');
    expect(output.textContent).toBe('3 rainy cells');
    await switchTo('ko');
    expect(button.textContent).toBe('발견');
    expect(button.getAttribute('title')).toBe('닫기');
    expect(output.textContent).toBe('비 3곳');
  });

  it('preserves user names, input values, and non-UI source text', async () => {
    start('<span translate="no">물</span><input value="모래"><code>구름</code>');
    expect(document.querySelector('span')!.textContent).toBe('물');
    expect(document.querySelector('input')!.value).toBe('모래');
    expect(document.querySelector('code')!.textContent).toBe('구름');
    await switchTo('ko');
    await switchTo('en');
    expect(document.querySelector('span')!.textContent).toBe('물');
  });

  it('uses the first supported browser preference and honors a saved selection', async () => {
    vi.stubGlobal('navigator', {language: 'fr-FR', languages: ['fr-FR', 'en-GB', 'ko-KR']});
    start('', null);
    expect(currentLocale()).toBe('en');
    await switchTo('ko');
    expect(localStorage.getItem('sandsphere-language')).toBe('ko');
    dispose?.();
    start('', 'ko');
    expect(currentLocale()).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
  });

  it('covers material, research, map, metric, and expedition vocabulary', () => {
    start();
    const phrases = [
      ...MATERIALS.flatMap(m => [m.name, m.type, m.note]),
      ...RESEARCH.flatMap(r => [r.name, r.science, r.rule, r.source]),
      ...Object.values(CLIMATE_LAYERS).flatMap(layer => [layer.name, layer.legend]),
      ...METRICS.flatMap(m => [m.name, m.tip ?? '', m.unit]),
      ...EXPEDITIONS.flatMap(e => [e.name, e.detail, e.chapter, e.hint]),
      ...Object.values(MATERIAL_SOURCES),
    ].filter(Boolean);
    const missing = phrases.filter(p => /[가-힣]/.test(translatePhrase(p)));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('keeps context, measurements, and user names intact in composed labels', () => {
    start();
    expect(translatePhrase('전체')).toBe('All');
    expect(translatePhrase('전체', 'dashboard.page.overview')).toBe('Overview');
    expect(translatePhrase('물', 'dashboard.page.matter')).toBe('Matter');
    expect(translatePhrase(' 모래 · 8셀 ')).toBe(' Sand · 8 cells ');
    expect(translatePhrase('메탄 · CH₄')).toBe('Methane · CH₄');
    expect(translatePhrase('물 이름을 저장했습니다.')).toBe('물 name saved.');
    expect(translatePhrase('구름과 강수 발견')).toBe('Clouds and precipitation discovered');
  });
});
