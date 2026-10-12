import {describe, expect, it} from 'vitest';
import {CameraGestures} from '../src/render/cameraGestures';

const pointer = (pointerType: string, button = 0, pointerId = 1, shiftKey = false) => ({pointerType, button, pointerId, shiftKey});

describe('camera gesture simulation gate', () => {
  it('keeps touch painting live until the application starts navigation', () => {
    const gestures = new CameraGestures();
    gestures.down(pointer('touch'), false);
    expect(gestures.active).toBe(false);
    gestures.setTouchNavigation(true);
    expect(gestures.active).toBe(true);
    // Releasing one contact must not enable painting during a pinch.
    gestures.release(1);
    expect(gestures.active).toBe(true);
    gestures.setTouchNavigation(false);
    expect(gestures.active).toBe(false);
  });

  it('suspends for inspection, right-drag, and Shift-drag while leaving editing live', () => {
    for (const type of ['mouse', 'pen']) {
      const gestures = new CameraGestures();
      gestures.down(pointer(type), false);
      expect(gestures.active).toBe(false);
      for (const [button, inspection, shift] of [[0, true, false], [2, false, false], [0, false, true]] as const) {
        gestures.down(pointer(type, button, 1, shift), inspection);
        expect(gestures.active).toBe(true);
        gestures.release(1);
        expect(gestures.active).toBe(false);
      }
    }
  });

  it('clears every navigation source when the window loses focus', () => {
    const gestures = new CameraGestures();
    gestures.down(pointer('mouse', 2), false);
    gestures.setTouchNavigation(true);
    gestures.clear();
    expect(gestures.active).toBe(false);
  });
});
