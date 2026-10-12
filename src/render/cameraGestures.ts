type CameraPointer = Pick<PointerEvent, 'pointerId' | 'pointerType' | 'button' | 'shiftKey'>;

/** Only navigation gestures suspend simulation and surface refreshes. */
export class CameraGestures {
  private pointers = new Set<number>();
  private touchNavigation = false;

  get active() { return this.touchNavigation || this.pointers.size > 0; }

  down(event: CameraPointer, inspection: boolean) {
    // The application classifies one-finger editing and multi-touch navigation.
    if (event.pointerType === 'touch') return;
    if (event.button === 2 || event.button === 0 && (inspection || event.shiftKey)) {
      this.pointers.add(event.pointerId);
    }
  }

  release(id: number) { this.pointers.delete(id); }
  setTouchNavigation(active: boolean) { this.touchNavigation = active; }
  clear() { this.pointers.clear(); this.touchNavigation = false; }
}
