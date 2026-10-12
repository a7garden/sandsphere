import {setPlanetSettings} from './planetControls';

/** UI-only navigation; the same live readouts stay mounted in every tab. */
export function setupWorkbench() {
  const app = document.querySelector<HTMLElement>('.app')!;
  const viewDock = document.querySelector<HTMLElement>('.view-transport-dock')!;
  const displayControls = document.querySelector<HTMLElement>('.scene-display-controls')!;
  const sizeChrome = new ResizeObserver(() => {
    app.style.setProperty('--mobile-transport-height', `${viewDock.getBoundingClientRect().height}px`);
    app.style.setProperty('--view-dock-width', `${viewDock.getBoundingClientRect().width}px`);
    app.style.setProperty('--display-controls-height', `${displayControls.getBoundingClientRect().height}px`);
  });
  sizeChrome.observe(viewDock);
  sizeChrome.observe(displayControls);
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.inspector-tabs [role="tab"]')];
  const selectTab = (selected: HTMLButtonElement) => {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')!)!.hidden = !active;
    }
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[next]);
      tabs[next].focus();
    });
  });

  const mobile = matchMedia('(max-width: 960px)');
  const timeControls = document.querySelector<HTMLElement>('.time-controls')!;
  const timeReadout = document.querySelector<HTMLElement>('.game-time-readout')!;
  const placeReadout = () => (mobile.matches ? viewDock : timeControls).append(timeReadout);
  placeReadout();
  mobile.addEventListener('change', placeReadout);
  const menuToggle = document.getElementById('workbench-menu-toggle')!;
  const menu = document.getElementById('workbench-menu')!;
  const setMenu = (open: boolean, restoreFocus = false) => {
    app.dataset.menuOpen = String(open);
    menuToggle.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector<HTMLButtonElement>('button')?.focus();
    else if (restoreFocus) menuToggle.focus();
  };
  const actionLabels: Record<string, string> = {
    'dashboard-open': '대시보드',
    'notifications-open': '알림', 'account-open': '계정과 저장', 'settings-open': '설정',
  };
  for (const button of menu.querySelectorAll<HTMLButtonElement>('.icon-button')) {
    const label = document.createElement('span');
    label.className = 'action-label';
    label.textContent = actionLabels[button.id] ?? button.getAttribute('aria-label');
    button.append(label);
  }
  menuToggle.addEventListener('click', () => setMenu(app.dataset.menuOpen !== 'true'));
  menu.addEventListener('click', event => {
    if (!mobile.matches || !(event.target as Element).closest('button')) return;
    setMenu(false);
    // Dialogs remember their opener; restore to the visible menu trigger on phones.
    queueMicrotask(() => {
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
      if (dialog) dialog.addEventListener('close', () => queueMicrotask(() => {
        if (mobile.matches && !document.querySelector('dialog[open]')) menuToggle.focus();
      }), {once: true});
      else menuToggle.focus();
    });
  });
  document.addEventListener('pointerdown', event => {
    if (!(event.target as Element).closest('#workbench-menu, #workbench-menu-toggle')) setMenu(false);
  });
  document.addEventListener('focusin', event => {
    if (!(event.target as Element).closest('#workbench-menu, #workbench-menu-toggle')) setMenu(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobile.matches && app.dataset.menuOpen === 'true') {
      event.preventDefault();
      setMenu(false, true);
    }
  });
  const sectionOptions = document.getElementById('section-options-toggle')!;
  sectionOptions.addEventListener('click', () => {
    const expanded = sectionOptions.getAttribute('aria-expanded') !== 'true';
    sectionOptions.setAttribute('aria-expanded', String(expanded));
    document.getElementById('section-controls')!.classList.toggle('section-options-open', expanded);
  });
  const panels = ['materials', 'observation'] as const;
  type Panel = typeof panels[number];
  const expanded: Record<Panel, boolean> = {materials: true, observation: true};
  const setDesktopPanel = (panel: Panel, open: boolean) => {
    expanded[panel] = open;
    app.classList.toggle(`${panel}-collapsed`, !open);
    const toggle = document.getElementById(`toggle-${panel}`)!;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', `${panel === 'materials' ? '도구' : '관측'} 패널 ${open ? '접기' : '펼치기'}`);
    toggle.title = toggle.getAttribute('aria-label')!;
    if (!open) toggle.focus();
  };
  for (const panel of panels) {
    document.getElementById(`toggle-${panel}`)!.addEventListener('click', () => setDesktopPanel(panel, !expanded[panel]));
  }
  let active: Panel | undefined;
  const viewToggle = document.getElementById('mobile-view-toggle')!;
  const setViewControls = (open: boolean, restoreFocus = false) => {
    app.dataset.mobileView = String(open);
    viewToggle.setAttribute('aria-expanded', String(open));
    if (!open) {
      setPlanetSettings(false);
      const mapToggle = document.getElementById('climate-map-toggle')!;
      if (mapToggle.getAttribute('aria-expanded') === 'true') mapToggle.click();
    }
    if (restoreFocus) viewToggle.focus();
  };
  setViewControls(false);
  const setPanel = (next?: Panel, restoreFocus = false) => {
    const previous = active;
    active = next;
    if (next && mobile.matches) setViewControls(false);
    app.dataset.mobilePanel = next ?? '';
    for (const panel of panels) {
      document.getElementById(`workspace-${panel}`)!.setAttribute('aria-expanded', String(panel === next));
      document.getElementById(`workspace-${panel}`)!.setAttribute('aria-label', `${panel === 'materials' ? '도구' : '관측'} 패널 ${panel === next ? '접기' : '펼치기'}`);
    }
    if (restoreFocus && previous) document.getElementById(`workspace-${previous}`)!.focus();
    else if (next) document.getElementById(next === 'materials' ? 'settings-toggle' : 'inspector-toggle')!.focus();
  };
  viewToggle.addEventListener('click', () => {
    const open = app.dataset.mobileView !== 'true';
    if (open) setPanel();
    setViewControls(open);
  });
  document.getElementById('planet')!.addEventListener('pointerdown', () => {
    if (mobile.matches) { setPanel(); setViewControls(false); }
  });
  for (const panel of panels) {
    document.getElementById(`workspace-${panel}`)!.addEventListener('click', () => setPanel(active === panel ? undefined : panel));
  }
  for (const id of ['settings-toggle', 'inspector-toggle']) {
    document.getElementById(id)!.addEventListener('click', () => {
      if (mobile.matches) setPanel(undefined, true);
      else setDesktopPanel(id === 'settings-toggle' ? 'materials' : 'observation', false);
    });
  }
  // Selecting an editing tool should expose the canvas immediately on phones.
  document.getElementById('materials-panel')!.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-material], [data-tool]');
    if (mobile.matches && active === 'materials' && button?.getAttribute('aria-pressed') === 'true') {
      setPanel();
      document.getElementById('planet')!.focus({preventScroll: true});
    }
  });
  // A drawer is non-modal: the planet and transport remain usable.
  document.addEventListener('keydown', event => {
    if (!event.defaultPrevented && event.key === 'Escape' && mobile.matches && app.dataset.mobileView === 'true' && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      event.stopPropagation();
      setViewControls(false, true);
      return;
    }
    if (event.defaultPrevented || event.key !== 'Escape' || !mobile.matches || !active || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    event.stopPropagation();
    // Dismiss a nested surface first, keeping the underlying drawer and selection.
    for (const [surface, close] of [['catalog', 'catalog-close'], ['planet-settings', 'planet-settings-close'], ['section-selection-controls', 'section-selection-cancel']]) {
      if (!document.getElementById(surface)!.hidden) {
        document.getElementById(close)!.click();
        return;
      }
    }
    setPanel(undefined, true);
  });
  for (const id of ['overview-open']) {
    document.getElementById(id)!.addEventListener('click', () => setPanel());
  }
  mobile.addEventListener('change', () => {
    const focused = document.activeElement;
    setMenu(false);
    setPanel();
    setViewControls(false);
    if (focused instanceof HTMLElement && !focused.getClientRects().length) document.getElementById('planet')!.focus();
  });
}
