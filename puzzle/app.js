import { validateQuotes, createState, reduce, choicesFor, RESTART_MS, VICTORY_BEATS } from './game.mjs';

const NAME = /^[A-Za-z0-9 _-]{1,16}$/;
const pct = value => `${(value * 100).toFixed(value < .001 ? 3 : 1)}%`;
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ } },
};

export function createController() {
  const $ = id => document.getElementById(`puzzle-${id}`);
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const motion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches && !matchMedia('(forced-colors: active)').matches;
  let data, state, generation = 0, loadGeneration = 0, disposed = false, victoryRunning = false, audio;
  let skippedKey = null, endRun = 0;
  let muted = storage.get('delos-quote-mute') === 'true';
  let best = {};
  try {
    const stored = JSON.parse(storage.get('delos-quote-best') || '{}');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) for (const [id, win] of Object.entries(stored)) {
      if (win && Number.isFinite(win.score) && win.score >= 0 && /^[SABCD]$/.test(win.rank)) best[id] = { score: win.score, rank: win.rank };
    }
  } catch { /* Ignore malformed or inaccessible storage. */ }
  const timers = new Set(), animations = new Set(), listeners = [];
  function listen(node, type, fn, options) { node.addEventListener(type, fn, options); listeners.push(() => node.removeEventListener(type, fn, options)); }
  function later(fn, ms) {
    const token = generation;
    const id = setTimeout(() => { timers.delete(id); if (!disposed && token === generation) fn(); }, ms);
    timers.add(id); return id;
  }
  function cancel() {
    generation++;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const animation of animations) animation.cancel();
    animations.clear();
    $('stage').classList.remove('puzzle-scan'); $('stage').classList.remove('puzzle-glitch');
    $('popup').hidden = true;
  }
  function animate(node, frames, options) {
    if (!motion() || !node?.animate) return;
    const animation = node.animate(frames, options); animations.add(animation);
    animation.onfinish = animation.oncancel = () => animations.delete(animation);
  }
  function awaken() {
    if (muted) return;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return;
      audio ||= new Audio();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch { /* Blocked audio never blocks input. */ }
  }
  function sound(kind) {
    if (muted || !audio || audio.state !== 'running') return;
    try {
      const now = audio.currentTime;
      const tones = kind === 'clunk' ? [[110, .13, .09], [55, .18, .06]] : kind === 'chord' ? [[261.63, .7, .035], [329.63, .8, .035], [392, .9, .035]] : [[75, .2, .05], [79, .22, .04]];
      for (const [frequency, duration, volume] of tones) {
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.type = kind === 'buzz' ? 'sawtooth' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, now);
        gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
        oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(now); oscillator.stop(now + duration);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
    } catch { /* Audio is decorative. */ }
  }
  function muteLabel() { $('mute').textContent = muted ? '♪̸' : '♪'; $('mute').setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound'); $('mute').setAttribute('aria-pressed', String(muted)); }
  muteLabel();
  $('theme').value = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  listen($('theme'), 'change', event => {
    document.documentElement.dataset.theme = event.target.value === 'light' ? 'light' : 'dark';
    storage.set('delos-quote-theme', document.documentElement.dataset.theme);
  });
  function levelTicks() {
    $('levels').replaceChildren();
    const firstUnwon = data.levels.findIndex(level => !best[level.id]);
    data.levels.forEach((level, index) => {
      const button = el('button', 'puzzle-level', `${String(index + 1).padStart(2, '0')} ${best[level.id]?.rank || '·'}`);
      button.type = 'button'; button.disabled = !best[level.id] && index !== firstUnwon;
      button.setAttribute('aria-label', `Level ${index + 1}${best[level.id] ? `, best rank ${best[level.id].rank}` : ', not yet won'}`);
      if (index === state.levelIndex) button.setAttribute('aria-current', 'step');
      button.addEventListener('click', () => start(index)); $('levels').append(button);
      if (index === state.levelIndex) button.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    });
  }
  function inspect(stepIndex, word) {
    const step = data.levels[state.levelIndex].steps[stepIndex];
    const choice = [step.gold, ...step.candidates].find(option => option.word === word);
    if (!choice) return;
    $('inspect-word').textContent = choice.word;
    $('pieces').replaceChildren(...choice.pieces.map(piece => el('span', '', piece.replaceAll('▁', '␠'))));
    $('inspect-ids').textContent = `IDS / ${choice.ids.join(' · ')}`;
    $('idle').hidden = true; $('inspect-word').hidden = false;
    $('inspector-title').textContent = stepIndex < state.stepIndex ? 'ACCEPTED / TOKEN SPLIT' : 'REJECTED / TOKEN SPLIT';
    const allowed = stepIndex < state.stepIndex || (stepIndex === state.stepIndex && state.consulted);
    $('host').hidden = !allowed; $('host-word').textContent = '';
    if (allowed) showHost(step);
    animate($('pieces'), [{ transform: 'translateY(5px)' }, { transform: 'translateY(0)' }], { duration: 900 });
  }
  function showHost(step) {
    const host = [step.gold, ...step.candidates].reduce((a, b) => a.prob >= b.prob ? a : b);
    $('host').hidden = false; $('host-word').textContent = `${host.word} / ${pct(host.prob)}`;
  }

  const columns = new Map();
  $('stage').append($('victory'));
  function makeNode(word) {
    const node = el('div', 'puzzle-chain-node');
    node.append(el('small', '', '▶ FORWARD CHAIN'), el('strong', '', word), el('span', 'puzzle-port', '▷'));
    return node;
  }
  function renderTree(correct = false) {
    const level = data.levels[state.levelIndex], pending = state.phase === 'choosing';
    const stamp = state.revision, stepIndex = state.stepIndex;
    const oldRects = new Map();
    for (const [key, column] of columns) for (const child of column.children) oldRects.set(child, child.getBoundingClientRect?.());
    let chain = $('nodes').querySelector('.puzzle-context-chain');
    if (!chain) { chain = el('div', 'puzzle-context-chain'); $('nodes').append(chain); }
    chain.replaceChildren();
    const mobile = matchMedia('(max-width:799px)').matches;
    const expanded = pending && !mobile ? Math.min(stepIndex, Math.max(0, Math.floor(($('stage').clientWidth - 580) / 194))) : 0;
    const firstExpanded = stepIndex - expanded;
    const context = [...level.prefix.split(/\s+/).map(word => ({ word })), ...level.steps.slice(0, firstExpanded).map((step, index) => ({ word: step.gold.word + step.after, index }))];
    for (const entry of context) {
      const node = el(entry.index === undefined ? 'div' : 'button', 'puzzle-compact-node');
      node.dataset.contextWord = entry.word; node.dataset.kind = entry.index === undefined ? 'context' : 'locked';
      node.append(el('small', '', entry.index === undefined ? 'CONTEXT' : 'LOCKED'), el('strong', '', entry.word));
      if (entry.index !== undefined) { node.type = 'button'; node.addEventListener('click', () => inspect(entry.index, level.steps[entry.index].gold.word)); }
      chain.append(node);
    }
    const last = pending ? stepIndex : stepIndex - 1;
    for (let index = 0; index <= last; index++) {
      const accepted = index < stepIndex, step = level.steps[index];
      if (index < firstExpanded) { const old = columns.get(index); if (old) { old.hidden = true; old.removeAttribute?.('role'); old.removeAttribute?.('aria-label'); delete old.node.dataset.contextWord; } continue; }
      let column = columns.get(index);
      if (!column) {
        column = el('div', 'puzzle-column'); column.dataset.step = String(index);
        const { choices } = choicesFor(data, state.levelIndex, index, state.attempt);
        column.chips = choices.map((choice, choiceIndex) => {
          const chip = el('button', 'puzzle-chip', choice.word); chip.type = 'button'; chip.dataset.word = choice.word; chip.dataset.index = String(choiceIndex); chip.setAttribute('aria-label', choice.word);
          chip.addEventListener('click', event => {
            if (event.detail > 1 || index !== state.stepIndex || column.dataset.revision !== String(state.revision)) return;
            pick(choiceIndex, Number(column.dataset.revision));
          });
          chip.addEventListener('keydown', event => {
            if (!['ArrowUp', 'ArrowDown', 'j', 'k'].includes(event.key)) return;
            event.preventDefault(); const enabled = column.chips.filter(c => !c.disabled), at = enabled.indexOf(chip);
            enabled[Math.max(0, Math.min(enabled.length - 1, at + (['ArrowUp', 'k'].includes(event.key) ? -1 : 1)))]?.focus();
          });
          return chip;
        });
        column.node = makeNode('?'); column.pendingChip = el('span', 'puzzle-chip puzzle-chosen', '?');
        column.consult = el('button', 'puzzle-column-consult', 'CONSULT −12%'); column.consult.type = 'button';
        column.consult.addEventListener('click', () => { if (index === state.stepIndex) dispatch({ type: 'consult' }); });
        column.append(column.pendingChip, column.node, column.consult, ...column.chips);
        $('nodes').append(column); columns.set(index, column);
      }
      column.classList.toggle('puzzle-history', accepted);
      column.dataset.revision = String(stamp);
      column.hidden = false; column.style.left = ''; column.style.top = '';
      column.style.setProperty('--stagger', index - firstExpanded);
      column.style.gridColumn = String(index - firstExpanded + 2);
      if (accepted) {
        column.removeAttribute?.('role'); column.removeAttribute?.('aria-label');
        const chosenIndex = column.chips.findIndex(chip => chip.dataset.word === step.gold.word), chosen = column.chips[chosenIndex];
        chosen.classList.add('puzzle-chosen'); column.node.children[1].textContent = step.gold.word;
        column.replaceChildren(...column.chips.slice(0, chosenIndex), chosen, column.node, ...column.chips.slice(chosenIndex + 1));
        column.node.dataset.contextWord = step.gold.word + step.after; column.node.dataset.kind = 'expanded';
        for (const chip of column.chips) { chip.disabled = true; chip.tabIndex = -1; }
      } else {
        column.setAttribute('role', 'group'); column.setAttribute('aria-label', 'Next word candidates');
        column.consult.disabled = state.consulted;
        delete column.node.dataset.contextWord;
        for (const chip of column.chips) {
          const rejected = state.rejected.includes(chip.dataset.word); chip.disabled = rejected; chip.classList.toggle('puzzle-rejected', rejected);
          chip.setAttribute('aria-label', `${chip.dataset.word}${rejected ? ', rejected' : ''}`);
          if (state.consulted && !chip.confidence) {
            const choice = state.choices[Number(chip.dataset.index)], meter = el('meter'); meter.min = 0; meter.max = 1; meter.value = choice.prob; meter.setAttribute('aria-label', `${choice.word} host confidence`);
            chip.append(meter, el('small', '', pct(choice.prob))); chip.confidence = true;
          }
        }
      }
    }
    $('nodes').style.setProperty('--expanded', expanded + (pending ? 1 : 0));
    $('tree').style.width = '100%';
    drawContext();
    $('play').dataset.phase = state.phase;
    const sentence = level.prefix + level.steps.slice(0, stepIndex).map(step => ` ${step.gold.word}${step.after}`).join('');
    $('sentence').replaceChildren(...sentence.split(' ').map((word, index) => el('span', '', `${index ? ' ' : ''}${word}`)));
    if (correct) for (const [child, before] of oldRects) {
      const after = child.getBoundingClientRect?.();
      if (before && after && child.className?.includes('puzzle-chip')) animate(child, [{ transform: `translate(${before.left - after.left}px,${before.top - after.top}px)` }, { transform: 'translate(0,0)' }], { duration: 300, easing: 'ease-out' });
    }

  }
  function drawContext() {
    $('paths').replaceChildren();
    if (!$('tree').getBoundingClientRect) return;
    const origin = $('tree').getBoundingClientRect();
    const nodes = [...$('nodes').querySelectorAll('[data-context-word]')];
    const pending = columns.get(state.stepIndex);
    if (state.phase === 'choosing' && pending) nodes.push(pending.pendingChip);
    for (let index = 1; index < nodes.length; index++) {
      const a = nodes[index - 1].getBoundingClientRect(), b = nodes[index].getBoundingClientRect();
      const x = a.right - origin.left, y = a.top + a.height / 2 - origin.top, endX = b.left - origin.left, endY = b.top + b.height / 2 - origin.top;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', endX < x ? `M${x} ${y} C${x + 10} ${y} ${x + 10} ${a.bottom - origin.top + 11} ${x} ${a.bottom - origin.top + 11} L${endX - 10} ${a.bottom - origin.top + 11} Q${endX - 10} ${endY} ${endX} ${endY}` : `M${x} ${y} C${x + 14} ${y} ${endX - 14} ${endY} ${endX} ${endY}`);
      $('paths').append(path);
    }
    const badge = $('nodes').querySelector('.puzzle-chain-badge'); badge?.remove();
    const compact = [...$('nodes').querySelectorAll('.puzzle-compact-node')];
    const visibleColumns = [...columns.values()].filter(column => !column.hidden);
    const firstColumn = visibleColumns.sort((a, b) => Number(a.style.gridColumn) - Number(b.style.gridColumn))[0];
    const last = compact.at(-1), end = firstColumn;
    if (state.phase === 'choosing' && last && end) {
      const a = last.getBoundingClientRect(), columnBox = end.getBoundingClientRect();
      const chosen = firstColumn.children[0].classList.contains('puzzle-chosen') ? firstColumn.children[0] : firstColumn.chips.find(chip => chip.classList.contains('puzzle-chosen'));
      const b = { left: columnBox.left, top: columnBox.top + (chosen?.offsetTop || 0), height: chosen?.offsetHeight || 26 };
      const chain = $('nodes').querySelector('.puzzle-context-chain').getBoundingClientRect();
      const mobile = matchMedia('(max-width:799px)').matches;
      const centerX = mobile ? (a.right + b.left) / 2 : b.left - 22;
      const centerY = mobile ? (chain.bottom + b.top) / 2 : (a.top + a.height / 2 + b.top + b.height / 2) / 2;
      const badge = el('span', 'puzzle-chain-badge'); badge.append(el('small', '', 'InEn'), el('b', '', '⟫'));
      Object.assign(badge.style, { left: `${centerX - origin.left - 15}px`, top: `${centerY - origin.top - 15}px` }); $('nodes').append(badge);
      const boundaryPath = $('paths').children[Math.max(0, compact.length - 1)];
      boundaryPath?.setAttribute('d', `M${a.right - origin.left} ${a.top + a.height / 2 - origin.top} C${centerX - origin.left} ${a.top + a.height / 2 - origin.top} ${centerX - origin.left} ${centerY - origin.top} ${centerX - origin.left} ${centerY - origin.top} S${centerX - origin.left} ${b.top + b.height / 2 - origin.top} ${b.left - origin.left} ${b.top + b.height / 2 - origin.top}`);
    }
    if (state.phase === 'choosing' && pending) {
      const target = pending.pendingChip.getBoundingClientRect();
      const mobile = matchMedia('(max-width:799px)').matches;
      Object.assign($('popup').style, { left: `${(mobile ? target.right + 8 : target.left + 16) - origin.left}px`, top: `${target.top - origin.top - (mobile ? 0 : 30)}px`, right: 'auto' });
    }
    $('paths').setAttribute('width', origin.width); $('paths').setAttribute('height', origin.height);
  }
  function meters() {
    $('stability-box').dataset.tier = state.stability < 25 ? 'critical' : state.stability < 50 ? 'warning' : 'stable';
    $('stability').textContent = `${state.stability}%`; $('meter').value = state.stability; $('meter').textContent = `${state.stability}%`;
  }
  function start(index) {
    if (!data || disposed || !Number.isInteger(index) || index < 0 || index >= data.levels.length) return;
    cancel(); endRun++; columns.clear(); $('nodes').replaceChildren(); victoryRunning = false;
    const revision = (state?.revision ?? 0) + 1;
    state = { ...createState(data, index), revision };
    $('stage').append($('victory')); document.querySelector('main').inert = false; $('skip').inert = false;
    $('victory').hidden = true; $('victory').removeAttribute('role'); $('victory').removeAttribute('aria-modal'); $('victory').classList.remove('puzzle-finale'); $('finale-action').hidden = true; $('next').hidden = true; $('replay').hidden = true; $('shutdown').hidden = true;
    $('attribution').textContent = ''; $('confidence').replaceChildren(); $('summary').replaceChildren(); $('summary').hidden = true;
    const level = data.levels[index];
    $('idle').hidden = false; $('idle').replaceChildren(...[level.act, `LEVEL ${String(index + 1).padStart(2, '0')} / ${data.levels.length}`, `${level.steps.length} ${level.steps.length === 1 ? 'WORD' : 'WORDS'} TO RECALL`, `BEST / ${best[level.id]?.rank || '—'}`].map(text => el('span', '', text)));
    $('inspector-title').textContent = 'RECALL SESSION'; $('inspect-word').hidden = true;
    $('instability').textContent = '';
    $('inspect-word').textContent = ''; $('pieces').replaceChildren(); $('inspect-ids').textContent = ''; $('host').hidden = true; $('host-word').textContent = '';
    $('heading').textContent = `${data.levels[index].act} / ${String(index + 1).padStart(2, '0')}`;
    $('status').textContent = 'AWAITING WORD'; $('play').setAttribute('aria-busy', 'false');
    $('retry').hidden = true; meters(); levelTicks(); renderTree(); columns.get(0)?.chips.find(chip => !chip.disabled)?.focus({ preventScroll: true });
  }
  function glitch(duration = 220) {
    if (!motion()) return;
    $('stage').classList.remove('puzzle-scan'); $('stage').classList.remove('puzzle-glitch');
    void $('stage').offsetWidth;
    $('stage').classList.add('puzzle-scan', 'puzzle-glitch');
    later(() => { $('stage').classList.remove('puzzle-scan'); $('stage').classList.remove('puzzle-glitch'); }, duration);
  }
  function confidence() {
    $('confidence').replaceChildren();
    const title = el('h3', 'puzzle-micro', 'HOST CONFIDENCE / 0–100%'); $('confidence').append(title);
    for (const step of data.levels[state.levelIndex].steps) {
      const item = el('div', 'puzzle-confidence-word');
      const meter = el('meter'); meter.min = 0; meter.max = 1; meter.value = step.gold.prob;
      meter.setAttribute('aria-label', step.gold.word); item.title = `${step.gold.word}: ${pct(step.gold.prob)}`;
      item.append(el('span', '', step.gold.word), meter, el('small', '', pct(step.gold.prob))); $('confidence').append(item);
    }
  }
  function attribution() {
    const source = data.levels[state.levelIndex].attribution;
    return [source.speaker, source.work, source.year].filter(value => value !== null && value !== '').join(' / ');
  }
  function board(rows) {
    $('board').replaceChildren(...rows.map(row => {
      const item = el('li'); item.append(el('span', '', row.name), el('span', '', row.total.toLocaleString()));
      return item;
    }));
  }
  async function endScreen() {
    const run = ++endRun;
    $('finale-action').hidden = false; $('score-form').hidden = false; $('board').replaceChildren(); $('board-status').textContent = 'Loading leaderboard…';
    try {
      const response = await fetch('/api/scores');
      const body = response.ok ? await response.json() : null;
      if (!Array.isArray(body?.top)) throw new Error('bad leaderboard');
      if (run !== endRun || disposed) return;
      board(body.top); $('board-status').textContent = 'TOP 20 / name · score';
    } catch {
      if (run !== endRun || disposed) return;
      // ponytail: offline fallback lists local bests only; no retry button, replay the level to try again.
      $('score-form').hidden = true; $('board-status').textContent = 'Leaderboard offline. Your local bests:';
      board(data.levels.map((level, index) => ({ name: `${String(index + 1).padStart(2, '0')} / ${best[level.id].rank}`, total: best[level.id].score })));
    }
  }
  async function submitScore(event) {
    event.preventDefault();
    if ($('score-submit').disabled) return;
    const name = $('name').value.trim();
    if (!NAME.test(name)) { $('board-status').textContent = 'Name: 1–16 letters, digits, space, _ or -'; $('name').focus(); return; }
    const run = endRun; $('score-submit').disabled = true; $('board-status').textContent = 'Submitting…';
    try {
      const levels = Object.fromEntries(data.levels.map(level => [level.id, Math.round(best[level.id].score)]));
      const response = await fetch('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, levels }) });
      const body = await response.json().catch(() => ({}));
      if (run !== endRun || disposed) return;
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      $('score-form').hidden = true; board(body.top); $('board-status').textContent = `SUBMITTED / RANK #${body.rank}`; $('next').focus({ preventScroll: true });
    } catch (error) { if (run === endRun && !disposed) $('board-status').textContent = `Not submitted: ${error.message}`; }
    finally { $('score-submit').disabled = false; }
  }
  const campaignComplete = () => data.levels.every(level => best[level.id]);
  function summary() {
    if (!campaignComplete()) return;
    $('summary').hidden = false; $('summary').replaceChildren();
    let total = 0;
    data.levels.forEach((level, index) => {
      const win = best[level.id]; total += win?.score || 0;
      $('summary').append(el('span', '', `${String(index + 1).padStart(2, '0')} / ${win?.rank || '—'}`));
    });
    $('summary').append(el('strong', '', `TOTAL / ${total.toLocaleString()}`));
    endScreen();
    $('victory').classList.add('puzzle-finale'); $('victory').setAttribute('role', 'dialog'); $('victory').setAttribute('aria-modal', 'true'); document.body.append($('victory')); document.querySelector('main').inert = true; $('skip').inert = true;
  }
  function finishVictory() {
    victoryRunning = false;
    $('attribution').textContent = attribution(); $('score').textContent = `${state.score.toLocaleString()} POINTS`;
    $('rank').textContent = state.rank; confidence(); summary(); $('next').hidden = false; $('replay').hidden = false;
    for (const word of $('sentence').children) word.style.color = 'var(--puzzle-green)';
    $('victory').dataset.beat = 'settled';
    (campaignComplete() ? $('victory-title') : $('next')).focus({ preventScroll: true });
  }
  function victory() {
    $('popup').hidden = true;
    const level = data.levels[state.levelIndex];
    if (!best[level.id] || state.score > best[level.id].score) {
      best[level.id] = { score: state.score, rank: state.rank }; storage.set('delos-quote-best', JSON.stringify(best));
    }
    levelTicks(); victoryRunning = true;
    $('victory').hidden = false; $('victory').dataset.beat = 'lock';
    $('victory-title').textContent = campaignComplete() ? 'ANALYSIS COMPLETE' : 'SEQUENCE COMPLETE';
    $('next').textContent = campaignComplete() ? 'Replay Campaign' : 'Next level';
    $('attribution').textContent = ''; $('score').textContent = ''; $('rank').textContent = ''; $('confidence').replaceChildren();
    $('status').textContent = campaignComplete() ? 'ANALYSIS COMPLETE' : 'SEQUENCE COMPLETE';
    if (!motion()) { finishVictory(); return; }
    const [waveAt, sourceAt, tallyAt, rankAt, confidenceAt, , focusAt] = VICTORY_BEATS;
    later(() => {
      $('victory').dataset.beat = 'wave'; sound('chord');
      const nodes = [...$('nodes').children, ...$('sentence').children];
      nodes.forEach((node, index) => animate(node, [{ color: 'var(--puzzle-green)', borderColor: 'var(--puzzle-green)', filter: 'brightness(1.6)' }, { color: 'var(--puzzle-green)', borderColor: 'var(--puzzle-green)', filter: 'brightness(1)' }], { delay: index * 650 / Math.max(1, nodes.length - 1), duration: 100, fill: 'forwards' }));
    }, waveAt);
    const source = attribution(), frames = Math.min(30, source.length);
    for (let i = 1; i <= frames; i++) later(() => { $('victory').dataset.beat = 'attribution'; $('attribution').textContent = source.slice(0, Math.ceil(source.length * i / frames)); }, sourceAt + (i - 1) * (tallyAt - sourceAt) / frames);
    for (let i = 0; i <= 30; i++) later(() => { $('victory').dataset.beat = 'score'; $('score').textContent = `${Math.round(state.score * i / 30).toLocaleString()} POINTS`; }, tallyAt + i * (rankAt - tallyAt) / 30);
    later(() => {
      $('victory').dataset.beat = 'rank'; $('rank').textContent = state.rank;
      animate($('rank'), [{ transform: 'scale(1.7)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300 });
    }, rankAt);
    later(() => {
      $('victory').dataset.beat = 'confidence'; confidence();
      animate($('confidence'), [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
    }, confidenceAt);
    later(() => finishVictory(), focusAt);
  }
  function skip(event) {
    if (!victoryRunning) return false;
    if (event.type === 'keydown' && (event.key === 'Tab' || event.metaKey || event.ctrlKey || event.altKey)) return false;
    if (event.type === 'keydown') skippedKey = event.key;
    event.preventDefault(); event.stopImmediatePropagation(); cancel(); finishVictory(); return true;
  }
  function pick(index, revision) {
    if (!state || state.revision !== revision || state.phase !== 'choosing' || !state.choices[index] || state.rejected.includes(state.choices[index].word)) return;
    dispatch({ type: 'select', index, revision });
    dispatch({ type: 'lock' });
  }
  function dispatch(action) {
    if (!state || disposed) return;
    const old = state; state = reduce(state, { revision: state.revision, ...action });
    if (old.revision === state.revision) return;
    meters();
    if (!state.events.some(event => event.type === 'correct')) renderTree();
    for (const event of state.events) {
      if (event.type === 'correct') {
        renderTree(true); inspect(event.stepIndex, event.word); sound('clunk');
        if (state.phase === 'choosing') columns.get(state.stepIndex)?.chips.find(chip => !chip.disabled)?.focus({ preventScroll: true });
        $('status').textContent = `LOCKED / ${event.word} / +${event.points}`;
        $('popup').hidden = false; $('popup').textContent = `+${event.points}`;
        animate($('popup'), [{ opacity: 1 }, { opacity: 0 }], { duration: 650 });
        later(() => $('popup').hidden = true, motion() ? 650 : 0);
      } else if (event.type === 'wrong') {
        inspect(event.stepIndex, event.word); glitch(); sound('buzz');
        const rejected = columns.get(event.stepIndex)?.chips.find(chip => chip.dataset.word === event.word);
        animate(rejected, [{ transform: 'translateX(-3px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }], { duration: 220 });
        $('status').textContent = `SOFTWARE INSTABILITY ▲ / −${event.cost}%`;
        $('instability').textContent = `▲ SOFTWARE INSTABILITY −${event.cost}%`;
        later(() => $('instability').textContent = '', motion() ? 900 : 0);
        const revision = state.revision;
        later(() => { if (state.revision === revision && state.phase === 'choosing') $('status').textContent = 'AWAITING WORD'; }, motion() ? 900 : 0);
      } else if (event.type === 'consult') {
        $('status').textContent = 'HOST CONSULTED / −12% / −120 POINTS';
        showHost(data.levels[state.levelIndex].steps[state.stepIndex]);
      }
      else if (event.type === 'shutdown') {
        cancel(); victoryRunning = false; glitch(250);
        $('shutdown').hidden = false; $('reboot').value = 0;
        for (let ms = 100; ms < RESTART_MS; ms += 100) later(() => { $('reboot').value = ms; }, ms);
        $('status').textContent = 'CRITICAL INSTABILITY / SHUTDOWN';
        const revision = state.revision;
        later(() => {
          columns.clear(); $('nodes').replaceChildren(); dispatch({ type: 'restart', revision }); $('host').hidden = true; $('host-word').textContent = ''; $('shutdown').hidden = true; $('status').textContent = 'LEVEL RESTARTED'; renderTree(); columns.get(0)?.chips.find(chip => !chip.disabled)?.focus({ preventScroll: true });
        }, RESTART_MS);
      } else if (event.type === 'won') victory();
    }
  }
  async function load() {
    const request = ++loadGeneration; $('retry').hidden = true; $('status').textContent = 'Loading quotations…';
    $('play').dataset.phase = 'loading'; $('play').setAttribute('aria-busy', 'true'); $('victory').hidden = true; $('shutdown').hidden = true;
    $('finale-action').hidden = true; $('stage').append($('victory')); $('victory').classList.remove('puzzle-finale'); $('victory').removeAttribute('role'); $('victory').removeAttribute('aria-modal'); document.querySelector('main').inert = false; $('skip').inert = false;
    try {
      const response = await fetch('./quotes.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const loaded = validateQuotes(await response.json());
      if (disposed || request !== loadGeneration) return;
      data = loaded;
      const first = data.levels.findIndex(level => !best[level.id]); start(first < 0 ? 0 : first);
    } catch (error) {
      if (disposed || request !== loadGeneration) return;
      $('status').textContent = `QUOTATIONS UNAVAILABLE / ${error.message}`; $('retry').hidden = false; $('play').setAttribute('aria-busy', 'false');
    }
  }
  const observer = new ResizeObserver(() => { if (state) renderTree(); }); observer.observe($('scroll'));
  listen(document, 'click', event => { awaken(); skip(event); }, true);
  listen(document, 'keyup', event => {
    if (event.key === skippedKey) { event.preventDefault(); event.stopImmediatePropagation(); skippedKey = null; }
  }, true);
  listen(document, 'keydown', event => {
    awaken();
    if (event.key === skippedKey) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    skip(event);
  }, true);
  listen($('next'), 'click', () => { if (!victoryRunning && state && ['won', 'complete'].includes(state.phase)) start(campaignComplete() ? 0 : state.levelIndex + 1 < data.levels.length ? state.levelIndex + 1 : data.levels.findIndex(level => !best[level.id])); });
  listen($('next'), 'keydown', event => {
    if (event.key === 'Enter' && !event.repeat && !victoryRunning) { event.preventDefault(); $('next').click(); }
  });
  listen($('replay'), 'click', () => { if (!victoryRunning && state && ['won', 'complete'].includes(state.phase)) start(state.levelIndex); });
  listen($('retry'), 'click', load);
  listen($('score-form'), 'submit', submitScore);
  listen($('mute'), 'click', () => { muted = !muted; storage.set('delos-quote-mute', String(muted)); muteLabel(); if (!muted) awaken(); });
  function dispose() { disposed = true; endRun++; loadGeneration++; cancel(); $('stage').append($('victory')); document.querySelector('main').inert = false; $('skip').inert = false; observer.disconnect(); for (const remove of listeners) remove(); if (audio) audio.close().catch(() => {}); }
  // A persisted page retains listeners, observers and deadlines; bfcache freezes/resumes them.
  listen(globalThis, 'pagehide', event => { if (!event.persisted) dispose(); });
  return { get state() { return state; }, get victoryRunning() { return victoryRunning; }, start, dispatch, dispose, ready: load() };
}
