import { parseMaze, createState, step, DT } from './maze.mjs';

async function loadMazeRenderer(options) {
  const { createMazeRenderer } = await import('./maze-renderer.mjs');
  return createMazeRenderer(options);
}

// ponytail: maze time is simulated play time (steps * DT): excludes pause/hidden tab, restarts on Reset.
export function createMazeView({ onWin, makeRenderer = loadMazeRenderer }) {
  const $ = id => document.getElementById(`maze-${id}`);
  const canvas = $('canvas'), status = $('status'), retry = $('retry'), pause = $('pause');
  const listeners = [], directions = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], level: [0, 0] };
  let geometry, state, renderer, frame = 0, last = 0, elapsed = 0, ticks = 0, paused = false, failed = false, disposed = false, request = 0, tilt = { x: 0, y: 0 };
  let pointer = null, touchId = null, directionText = '', pressed = '';
  let zoomed = matchMedia('(max-width: 600px)').matches;
  function listen(node, type, fn, options) { node.addEventListener(type, fn, options); listeners.push(() => node.removeEventListener(type, fn, options)); }
  function select(input, name) {
    const { x, y } = input, length = Math.hypot(x, y), divisor = Math.max(1, length);
    tilt = Number.isFinite(length) ? { x: x / divisor, y: y / divisor } : { x: 0, y: 0 };
    if (!length) name = 'level';
    const text = `Tilt: ${name || [y < -1e-8 ? 'up' : y > 1e-8 ? 'down' : '', x < -1e-8 ? 'left' : x > 1e-8 ? 'right' : ''].filter(Boolean).join(' ') || 'level'}${length && length < .1 ? ' (gentle)' : ''}`;
    if (pressed !== name) { pressed = name; for (const key of Object.keys(directions)) $(key).setAttribute('aria-pressed', String(key === name)); }
    if (directionText !== text) { directionText = text; $('direction').textContent = text; }
  }
  function forgetPointer() { const id = touchId; pointer = null; touchId = null; if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); }
  function clearPointer() { forgetPointer(); select({ x: 0, y: 0 }); }
  function stop() { cancelAnimationFrame(frame); frame = 0; last = 0; elapsed = 0; clearPointer(); }
  function draw() { renderer.render(state, { zoomed }); }
  function fail(error) { failed = true; stop(); status.textContent = `Maze unavailable: ${error.message || error}. Retry.`; retry.hidden = false; }
  function tick(time) {
    frame = 0; if (disposed || paused || failed || document.hidden || !state) return;
    try {
      if (pointer) select(renderer.project(pointer.x, pointer.y));
      if (last) elapsed += Math.min((time - last) / 1000, DT * 16);
      last = time;
      let count = 0;
      while (elapsed >= DT && count++ < 16) {
        step(geometry, state, tilt); elapsed -= DT; ticks++;
        if (state.error) throw new Error(String(state.error));
        if (state.won) { stop(); onWin({ ms: Math.round(ticks * DT * 1000) }); return; }
      }
      draw(); frame = requestAnimationFrame(tick);
    } catch (error) { fail(error); }
  }
  function resume() { if (!disposed && !paused && !failed && !document.hidden && state && !frame) { last = 0; elapsed = 0; frame = requestAnimationFrame(tick); } }
  async function load() {
    const current = ++request; stop(); failed = true; retry.hidden = true; status.textContent = 'Loading wooden maze…';
    renderer?.dispose(); renderer = null;
    try {
      const response = await fetch(new URL('./maze.svg', import.meta.url)); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseMaze(await response.text()); if (disposed || current !== request) return;
      const created = await makeRenderer({ canvas, geometry: parsed, goalLabel: $('goal-label'),
        onContextLost() { if (!disposed && current === request) fail(new Error('Graphics context lost')); },
        onContextRestored() { if (!disposed && current === request) { status.textContent = 'Graphics restored. Retry to restart the maze.'; retry.hidden = false; } }
      });
      if (disposed || current !== request) { created.dispose(); return; }
      renderer = created; geometry = parsed; state = createState(geometry); ticks = 0; failed = false; paused = false; pause.textContent = 'Pause';
      status.textContent = 'Goal: the marked torso pocket.'; draw(); resume();
    } catch (error) { if (!disposed && current === request) { renderer?.dispose(); renderer = null; fail(error); } }
  }
  function zoomLabel() { $('zoom').textContent = zoomed ? 'Show whole maze' : 'Close-up view'; $('zoom').setAttribute('aria-pressed', String(zoomed)); }
  zoomLabel();
  listen($('zoom'), 'click', () => { zoomed = !zoomed; zoomLabel(); redraw(); });
  listen(retry, 'click', load);
  listen($('reset'), 'click', () => { if (!geometry || failed) return; stop(); state = createState(geometry); ticks = 0; renderer.reset(); paused = false; pause.textContent = 'Pause'; retry.hidden = true; status.textContent = 'Goal: the marked torso pocket.'; try { draw(); resume(); } catch (error) { fail(error); } });
  listen(pause, 'click', () => { if (!state || failed) return; paused = !paused; pause.textContent = paused ? 'Resume' : 'Pause'; if (paused) stop(); else resume(); });
  function cardinal(name) { if (!failed && !paused && renderer) { forgetPointer(); select(renderer.direction(...directions[name]), name); } }
  for (const name of Object.keys(directions)) listen($(name), 'click', () => cardinal(name));
  listen(canvas, 'pointerdown', event => {
    if (event.pointerType !== 'touch' || !event.isPrimary || touchId !== null || failed || paused || !renderer) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    touchId = event.pointerId; pointer = { id: event.pointerId, type: 'touch', x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  listen(canvas, 'pointermove', event => {
    if (!event.isPrimary || failed || paused || !renderer || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    if (event.pointerType === 'touch' && touchId !== event.pointerId) return;
    if (touchId !== null && touchId !== event.pointerId) return;
    pointer = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY };
  });
  listen(canvas, 'pointerleave', event => { if (pointer && pointer.id === event.pointerId && pointer.type !== 'touch') clearPointer(); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, type, event => {
    if (touchId === event.pointerId) touchId = null;
    if (pointer && pointer.id === event.pointerId && (pointer.type === 'touch' || type !== 'pointerup')) clearPointer();
  });
  for (const node of [canvas, ...Object.keys(directions).map($), pause, $('reset'), retry, $('zoom')]) {
    listen(node, 'keydown', event => { const name = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key]; if (name && !failed && !paused) { event.preventDefault(); if (!event.repeat) cardinal(name); } });
    listen(node, 'blur', event => { if (!event.relatedTarget?.closest?.('#maze')) clearPointer(); });
  }
  listen(window, 'blur', clearPointer);
  listen(document, 'visibilitychange', () => { if (document.hidden) stop(); else resume(); });
  listen(window, 'pagehide', stop); listen(window, 'pageshow', resume);
  function redraw() { if (state && renderer && !failed) try { draw(); } catch (error) { fail(error); } }
  listen(window, 'resize', redraw);
  listen(matchMedia('(forced-colors: active)'), 'change', redraw);
  load();
  return { redraw, dispose() { if (disposed) return; disposed = true; request++; stop(); renderer?.dispose(); renderer = null; for (const remove of listeners) remove(); } };
}
