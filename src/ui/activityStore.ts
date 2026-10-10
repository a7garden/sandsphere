export type ActivityKind = 'discovery' | 'expedition' | 'system' | 'error';
export interface ActivityNotice {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  glyph: string;
  target?: string;
  time: number | null;
  read: boolean;
}
export type NewNotice = Pick<ActivityNotice, 'kind' | 'title' | 'detail' | 'glyph' | 'target'>;
const kinds: ActivityKind[] = ['discovery', 'expedition', 'system', 'error'];

export function readActivityHistory(raw: string | null): ActivityNotice[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const ids = new Set<string>();
    return parsed.filter((n): n is ActivityNotice => {
      if (!n || typeof n !== 'object' || typeof n.id !== 'string' || ids.has(n.id)
        || !kinds.includes(n.kind) || typeof n.title !== 'string' || typeof n.detail !== 'string'
        || typeof n.glyph !== 'string' || typeof n.read !== 'boolean'
        || (n.target !== undefined && typeof n.target !== 'string')
        || (n.time !== null && (typeof n.time !== 'number' || !Number.isFinite(n.time) || n.time <= 0 || n.time > 8.64e15))) return false;
      ids.add(n.id);
      return true;
    }).slice(0, 100);
  } catch { return []; }
}

export class ActivityStore {
  constructor(public notices: ActivityNotice[] = []) {}
  get unread() { return this.notices.filter(n => !n.read).length; }
  add(notice: NewNotice, now: number): boolean {
    if (notice.kind === 'discovery' && this.notices.some(n => n.kind === 'discovery' && n.target === notice.target)) return false;
    const latest = this.notices[0];
    if (latest?.time && now - latest.time < 30_000 && latest.kind === notice.kind
      && latest.title === notice.title && latest.detail === notice.detail && latest.target === notice.target) return false;
    this.notices.unshift({ ...notice, id: crypto.randomUUID(), time: now, read: false });
    this.notices = this.notices.slice(0, 100);
    return true;
  }
  seedDiscoveries(notices: NewNotice[]) {
    for (const notice of notices) {
      if (this.notices.some(n => n.kind === 'discovery' && n.target === notice.target)) continue;
      this.notices.push({ ...notice, id: `discovery-${notice.target}`, time: null, read: true });
    }
    this.notices = this.notices.slice(0, 100);
  }
  markRead(id?: string) { this.notices.forEach(n => { if (!id || n.id === id) n.read = true; }); }
}
