import { createController } from './app.js';
import { createMazeView } from './maze-view.js';

export function bootstrap({ makeMaze = createMazeView, makeQuotes = createController } = {}) {
  const $ = id => document.getElementById(id);
  const key = 'delos-maze-complete-v1', timeKey = 'delos-maze-ms-v1', listeners = [];
  let view, controller, token = 0, phase = 'initial', heldKey = null, blockedKey = null;
  const listen = (node, type, fn, options) => { node.addEventListener(type, fn, options); listeners.push(() => node.removeEventListener(type, fn, options)); };
  const stored = () => { try { return localStorage.getItem(key) === 'won'; } catch { return false; } };
  function quotes() {
    if (phase !== 'dialogue' && phase !== 'initial') return;
    phase = 'quotes'; token++; view?.dispose(); view = null;
    $('maze').hidden = true; $('maze-dialogue').hidden = true;
    $('puzzle-play').hidden = false; $('puzzle-stability-box').hidden = false; $('puzzle-mute').hidden = false;
    $('puzzle-skip').href = '#puzzle-scroll';
    controller = makeQuotes();
  }
  function maze() {
    if (phase === 'disposed') return;
    phase = 'maze'; const generation = ++token;
    controller?.dispose(); controller = null; view?.dispose(); view = null;
    $('puzzle-play').hidden = true; $('puzzle-stability-box').hidden = true; $('puzzle-mute').hidden = true;
    $('maze-dialogue').hidden = true; $('maze').hidden = false; $('puzzle-skip').href = '#maze-canvas';
    view = makeMaze({ onWin(result) {
      if (phase !== 'maze' || generation !== token) return;
      phase = 'dialogue'; token++; blockedKey = heldKey;
      try {
        localStorage.setItem(key, 'won');
        const ms = Number(result?.ms), old = Number(localStorage.getItem(timeKey));
        if (Number.isInteger(ms) && ms > 0 && !(old > 0 && old <= ms)) localStorage.setItem(timeKey, String(ms)); // best time kept
      } catch { /* In-session completion still works. */ }
      view?.dispose(); view = null;
      $('maze').hidden = true; $('maze-dialogue').hidden = false;
      $('puzzle-skip').href = '#maze-continue'; $('maze-continue').focus();
    } });
    $('maze-canvas').focus();
  }
  function dispose() {
    if (phase === 'disposed') return;
    phase = 'disposed'; token++; view?.dispose(); controller?.dispose();
    for (const remove of listeners) remove();
  }
  listen(document, 'keydown', event => {
    if (phase === 'maze' && (event.key === ' ' || event.key === 'Enter') && ['up', 'down', 'left', 'right', 'level'].some(name => event.target === $(`maze-${name}`))) heldKey = event.key;
    if (phase === 'dialogue' && event.key === blockedKey) {
      if (!event.repeat && !heldKey) blockedKey = null;
      else { event.preventDefault(); event.stopImmediatePropagation(); }
    }
  }, true);
  listen(document, 'keyup', event => {
    if (event.key === heldKey) heldKey = null;
    if (phase === 'dialogue' && event.key === blockedKey) { blockedKey = null; event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  listen(globalThis, 'blur', () => { heldKey = null; });
  listen($('maze-continue'), 'click', event => { if (blockedKey && event.detail === 0) { event.preventDefault(); event.stopImmediatePropagation(); return; } blockedKey = null; quotes(); });
  listen($('maze-replay'), 'click', maze);
  $('puzzle-theme').value = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  listen($('puzzle-theme'), 'change', event => {
    document.documentElement.dataset.theme = event.target.value === 'light' ? 'light' : 'dark';
    try { localStorage.setItem('delos-quote-theme', document.documentElement.dataset.theme); } catch {}
    view?.redraw();
  });
  listen(globalThis, 'pagehide', event => { if (!event.persisted) dispose(); });
  if (stored()) quotes(); else maze();
  return { dispose };
}
bootstrap();
