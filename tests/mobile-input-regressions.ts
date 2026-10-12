interface MobileStats {
  supplied: number;
  time: number;
  paused: boolean;
  tool: string;
  camera: number[];
  cursor: {down: boolean; brushCell: number | null};
}

/** Browser regression on the live app. Virtual pointer capture is scoped to
 * the test IDs; this verifies routing and supply, not physical device input. */
export async function verifyMobileInput(stats: () => MobileStats) {
  if (stats().tool !== 'pour' || stats().paused) throw new Error('Select a material and run the simulation first');
  const canvas = document.querySelector<HTMLCanvasElement>('#planet')!;
  const rect = canvas.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const ids = new Set([9101, 9102]);
  const originalSet = canvas.setPointerCapture, originalHas = canvas.hasPointerCapture;
  canvas.setPointerCapture = function(id) { if (!ids.has(id)) originalSet.call(this, id); };
  canvas.hasPointerCapture = function(id) { return ids.has(id) ? false : originalHas.call(this, id); };
  const send = (type: string, id: number, px = x, py = y) => canvas.dispatchEvent(new PointerEvent(type, {
    pointerId: id, pointerType: 'touch', button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: px, clientY: py, bubbles: true,
  }));
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (condition: () => boolean) => {
    const deadline = performance.now() + 4000;
    while (!condition() && performance.now() < deadline) await wait(30);
    if (!condition()) throw new Error('Mobile input condition timed out');
  };
  try {
    const before = stats();
    send('pointerdown', 9101, x - 28, y);
    await until(() => stats().supplied > before.supplied);
    const held = stats();
    send('pointermove', 9101, x + 28, y);
    await until(() => stats().supplied > held.supplied && stats().cursor.brushCell !== held.cursor.brushCell);
    const dragged = stats();
    send('pointerup', 9101, x + 28, y);
    const running = held.time > before.time && dragged.supplied > held.supplied &&
      dragged.camera.every((v, i) => v === before.camera[i]) && !stats().cursor.down;

    document.getElementById('pause')!.click();
    await wait(150);
    const pausedBefore = stats();
    send('pointerdown', 9101, x - 28, y);
    await wait(140);
    send('pointermove', 9101, x, y);
    const pausedFirst = stats();
    send('pointermove', 9101, x + 28, y);
    const pausedDragged = stats();
    send('pointerup', 9101, x + 28, y);
    const paused = pausedFirst.supplied > pausedBefore.supplied && pausedDragged.supplied > pausedFirst.supplied &&
      pausedDragged.time === pausedBefore.time;

    const pinchBefore = stats();
    send('pointerdown', 9101, x - 28, y);
    send('pointerdown', 9102, x + 28, y);
    send('pointermove', 9101, x - 10, y + 10);
    send('pointermove', 9102, x + 54, y + 10);
    await wait(150);
    const pinch = stats();
    send('pointerup', 9102, x + 54, y + 10);
    send('pointermove', 9101, x + 20, y + 10);
    await wait(150);
    const remaining = stats();
    send('pointerup', 9101, x + 20, y + 10);
    const navigation = pinch.supplied === pinchBefore.supplied && remaining.supplied === pinchBefore.supplied &&
      pinch.camera.some((v, i) => v !== pinchBefore.camera[i]) && !remaining.cursor.down;

    const cancelBefore = stats();
    send('pointerdown', 9101);
    send('pointercancel', 9101);
    send('pointermove', 9101, x + 28, y);
    await wait(150);
    const canceled = stats().supplied === cancelBefore.supplied && !stats().cursor.down;
    send('pointerdown', 9101);
    send('pointerup', 9101);
    const resumed = stats().supplied > cancelBefore.supplied;
    return {passed: running && paused && navigation && canceled && resumed, running, paused, navigation, canceled, resumed,
      runningSupply: dragged.supplied - before.supplied, pausedSupply: pausedDragged.supplied - pausedBefore.supplied};
  } finally {
    send('pointercancel', 9101); send('pointercancel', 9102);
    canvas.setPointerCapture = originalSet; canvas.hasPointerCapture = originalHas;
    if (stats().paused) document.getElementById('pause')!.click();
  }
}
