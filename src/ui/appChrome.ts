import { icon } from './icons';
import { ActivityStore, readActivityHistory, type NewNotice } from './activityStore';
import { currentLocale, translatePhrase } from './i18n';

export function appDialogsMarkup() {
  return `<dialog id="game-mode" aria-labelledby="game-mode-title"><div class="dialog-header"><h2 id="game-mode-title">게임 모드</h2><button class="icon-button dialog-close" aria-label="모드 선택 닫기">${icon('close')}</button></div><div class="dialog-body"><div id="first-entry-intro" class="first-entry-intro" hidden><span>Sandsphere</span><p>행성을 만들고 모래·물·열을 더해보세요. 한 지점을 고정하면 표면 온도와 날씨가 어떻게 바뀌는지 볼 수 있어요.</p></div><section id="entry-account-choice" class="entry-account-choice" aria-labelledby="entry-account-title" hidden><h3 id="entry-account-title">어디에 저장할까요?</h3><p id="entry-account-copy">로그인하면 계정에 게임을 저장하고 다른 기기에서 이어할 수 있어요. 게스트 게임은 이 브라우저에 저장됩니다.</p><button type="button" id="entry-login" class="entry-primary">로그인 또는 회원가입</button><button type="button" id="entry-guest" class="entry-secondary">게스트로 시작</button></section><section id="entry-mode-choice" class="entry-mode-choice" aria-labelledby="entry-mode-title"><h3 id="entry-mode-title" hidden>플레이 방식 선택</h3><p id="entry-signed-in" hidden></p><p>캠페인과 샌드박스의 행성과 보관함은 따로 저장됩니다.</p><div class="mode-options"><button type="button" data-game-mode="campaign"><strong>캠페인 <small>추천</small> <small class="mode-current" hidden>현재 모드</small></strong><span>물질을 발견하고 탐사 과제를 진행합니다. 생성물과 생물은 보관함 수량만큼 사용합니다.</span></button><button type="button" data-game-mode="sandbox"><strong>샌드박스 <small class="mode-current" hidden>현재 모드</small></strong><span>모든 물질을 처음부터 무제한으로 붓습니다. 탐사 과제와 보상은 적용되지 않습니다.</span></button></div></section></div></dialog>
<dialog id="notifications" class="notification-center" aria-labelledby="notifications-title">
<div class="dialog-header"><h2 id="notifications-title">알림 센터 <span id="notifications-count"></span></h2><button class="icon-button dialog-close" aria-label="알림 센터 닫기">${icon('close')}</button></div>
<div class="notification-toolbar"><div class="segmented-control" role="group" aria-label="알림 필터"><button data-notice-filter="all" aria-pressed="true">전체</button><button data-notice-filter="unread" aria-pressed="false">읽지 않음</button></div><button id="notifications-read-all" class="text-button">모두 읽음</button></div>
<div id="notification-list" class="notification-list"></div><p id="notification-empty" class="notification-empty" hidden>아직 알림이 없습니다.</p></dialog>
<dialog id="app-settings" class="app-settings" aria-labelledby="app-settings-title">
<div class="dialog-header"><h2 id="app-settings-title">설정</h2><button class="icon-button dialog-close" aria-label="설정 닫기">${icon('close')}</button></div>
<div class="dialog-body"><section class="settings-section" aria-labelledby="settings-language-title"><h3 id="settings-language-title">언어</h3><label class="settings-row" for="settings-language"><span>언어</span><select id="settings-language" class="settings-language-select"><option value="ko">한국어</option><option value="en">English</option></select></label></section><section class="settings-section" aria-labelledby="settings-notifications-title"><h3 id="settings-notifications-title">알림</h3><label class="settings-row" for="settings-notice-emphasis"><span>새 알림 강조 <small>새 소식이 오면 알림 아이콘을 잠시 강조</small></span><input id="settings-notice-emphasis" class="settings-switch" type="checkbox" role="switch" checked></label></section>
<div class="settings-footer"><button id="first-steps-open" class="text-button">첫 실험 안내</button><button id="help-open" class="text-button">${icon('info')}조작 방법</button><span>변경 사항은 바로 적용됩니다.</span></div></div></dialog>`;
}

export class ActivityCenter {
  private readonly store: ActivityStore;
  private filter = 'all';
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;
  private emphasis = true;
  private opener: HTMLElement | null = null;
  private readonly dialog = document.getElementById('notifications') as HTMLDialogElement;
  private readonly preview = document.getElementById('notifications-open')!;
  constructor(private onDiscovery: (id: string) => void, private readonly key = 'sandsphere-activity') {
    let raw = null;
    try { raw = localStorage.getItem(this.key); } catch { /* Optional local history. */ }
    this.store = new ActivityStore(readActivityHistory(raw));
    this.preview.addEventListener('click', () => this.open(this.preview));
    document.querySelectorAll<HTMLButtonElement>('[data-notice-filter]').forEach(button => button.addEventListener('click', () => {
      this.filter = button.dataset.noticeFilter!;
      this.render();
    }));
    document.getElementById('notifications-read-all')!.addEventListener('click', () => {
      this.store.markRead(); this.save(); this.render();
    });
    this.dialog.addEventListener('close', () => (this.opener?.getClientRects().length ? this.opener : document.getElementById('notifications-open'))?.focus());
    window.addEventListener('sandsphere-language-change', () => this.render());
    this.render();
  }
  seedDiscoveries(notices: NewNotice[]) { this.store.seedDiscoveries(notices); this.save(); this.render(); }
  setEmphasis(enabled: boolean) {
    this.emphasis = enabled;
    if (!enabled) { clearTimeout(this.highlightTimer); delete this.preview.dataset.attention; }
  }
  add(notice: NewNotice) {
    if (!this.store.add(notice, Date.now())) return;
    this.save(); this.render();
    if (this.emphasis) {
      this.preview.dataset.attention = 'true';
      clearTimeout(this.highlightTimer);
      this.highlightTimer = setTimeout(() => delete this.preview.dataset.attention, 6000);
    }
  }
  private open(opener: HTMLElement) {
    this.opener = opener;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }
  private save() { try { localStorage.setItem(this.key, JSON.stringify(this.store.notices)); } catch { /* Keep session history when storage is unavailable. */ } }
  private render() {
    const unread = this.store.unread;
    const badge = document.getElementById('notification-badge')!;
    badge.textContent = String(unread); badge.hidden = !unread;
    document.getElementById('notifications-open')!.setAttribute('aria-label', currentLocale() === 'en'
      ? (unread ? `Notifications · ${unread} unread` : 'Notifications')
      : (unread ? `알림 센터 · 읽지 않은 알림 ${unread}개` : '알림 센터'));
    document.getElementById('notifications-count')!.textContent = unread ? (currentLocale() === 'en' ? `${unread} unread` : `${unread}개 안 읽음`) : '';
    (document.getElementById('notifications-read-all') as HTMLButtonElement).disabled = !unread;
    document.querySelectorAll<HTMLButtonElement>('[data-notice-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.noticeFilter === this.filter)));
    const latest = this.store.notices[0];
    this.preview.title = latest?.time ? `${translatePhrase(latest.title)}${latest.detail ? ' · ' + translatePhrase(latest.detail) : ''} · ${currentLocale() === 'en' ? 'Open notifications' : '알림 센터 열기'}` : (currentLocale() === 'en' ? 'Open notifications' : '알림 센터 열기');
    const list = document.getElementById('notification-list')!;
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset.noticeId;
    list.replaceChildren();
    const notices = this.store.notices.filter(n => this.filter === 'all' || !n.read);
    const empty = document.getElementById('notification-empty')!;
    empty.hidden = !!notices.length; empty.textContent = this.filter === 'unread' ? '읽지 않은 알림이 없습니다.' : '아직 알림이 없습니다.';
    for (const notice of notices) {
      const row = document.createElement('article'); row.className = 'notification-row'; row.dataset.read = String(notice.read); row.dataset.kind = notice.kind;
      const glyph = document.createElement('span'); glyph.className = 'notification-glyph'; glyph.innerHTML = icon(notice.glyph); row.append(glyph);
      const body = document.createElement('div'); body.className = 'notification-content';
      const meta = document.createElement('div'); meta.className = 'notification-meta';
      const category = document.createElement('span'); category.textContent = translatePhrase({ discovery: '발견', expedition: '탐사 완료', system: '실험', error: '오류' }[notice.kind], `notice.kind.${notice.kind}`); meta.append(category);
      const time = document.createElement('time');
      if (notice.time) { time.dateTime = new Date(notice.time).toISOString(); time.textContent = new Intl.DateTimeFormat(currentLocale() === 'en' ? 'en-US' : 'ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(notice.time); }
      else time.textContent = currentLocale() === 'en' ? 'Earlier discovery' : '이전 발견';
      meta.append(time); body.append(meta);
      const title = document.createElement('h3'); title.textContent = translatePhrase(notice.title); body.append(title);
      if (notice.detail) { const detail = document.createElement('p'); detail.textContent = translatePhrase(notice.detail); body.append(detail); }
      const action = document.createElement('button'); action.className = 'notification-action'; action.textContent = notice.target ? '발견 기록 보기 →' : notice.read ? '읽음' : '읽음으로 표시'; action.disabled = notice.read && !notice.target;
      action.dataset.noticeId = notice.id;
      action.addEventListener('click', () => {
        this.store.markRead(notice.id); this.save(); this.render();
        if (notice.target) { this.dialog.close(); this.onDiscovery(notice.target); }
      });
      body.append(action); row.append(body); list.append(row);
    }
    if (focusedId) {
      const action = [...list.querySelectorAll<HTMLButtonElement>('[data-notice-id]')].find(b => b.dataset.noticeId === focusedId && !b.disabled);
      (action ?? this.dialog.querySelector<HTMLButtonElement>(`[data-notice-filter="${this.filter}"]`))?.focus();
    }
  }
}
