import { describe, it, expect } from 'vitest';
import { ActivityStore, readActivityHistory, type NewNotice } from '../src/ui/activityStore';

const discovery: NewNotice = { kind: 'discovery', title: '얼음 발견', detail: '물이 얼었습니다.', glyph: 'snow', target: 'ice' };
const system: NewNotice = { kind: 'system', title: '새 행성을 만들었습니다.', detail: '', glyph: 'planet' };

describe('activity inbox', () => {
  it('restores read state and rejects malformed, duplicate and invalid date entries', () => {
    const store = new ActivityStore();
    store.add(discovery, 1_000); store.add(system, 2_000);
    store.markRead(store.notices[0].id);
    const valid = store.notices;
    const history = readActivityHistory(JSON.stringify([...valid, valid[0], { ...valid[0], id: 'bad-date', time: 1e20 }, { id: 'missing-fields' }]));
    expect(history).toEqual(valid);
    expect(new ActivityStore(history).unread).toBe(1);
    expect(readActivityHistory('broken')).toEqual([]);
    expect(readActivityHistory('{}')).toEqual([]);
  });
  it('imports previous discoveries as read without fabricating timestamps or duplicating them', () => {
    const store = new ActivityStore();
    store.seedDiscoveries([discovery, discovery]);
    expect(store.notices).toHaveLength(1);
    expect(store.notices[0]).toMatchObject({ time: null, read: true, target: 'ice' });
    expect(store.unread).toBe(0);
    expect(store.add(discovery, 2_000)).toBe(false);
    const glass: NewNotice = { ...discovery, target: 'glass', title: '유리 발견' };
    expect(store.add(glass, 2_000)).toBe(true);
    store.seedDiscoveries([glass]);
    expect(store.notices).toHaveLength(2);
    expect(store.unread).toBe(1);
  });
  it('suppresses repeated feedback for 30 seconds and retains only the latest 100 events', () => {
    const store = new ActivityStore();
    expect(store.add(system, 1_000)).toBe(true);
    expect(store.add(system, 5_000)).toBe(false);
    expect(store.add(system, 31_000)).toBe(true);
    for (let i = 0; i < 105; i++) store.add({ ...system, title: `실험 ${i}` }, 100_000 + i);
    expect(store.notices).toHaveLength(100);
    expect(store.notices[0].title).toBe('실험 104');
    expect(store.notices.at(-1)?.title).toBe('실험 5');
    store.markRead();
    expect(store.unread).toBe(0);
  });
});
