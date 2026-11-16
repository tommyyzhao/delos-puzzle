export const MAX_STABILITY = 100;
export const WRONG_COSTS = Object.freeze([8, 16, 28]);
export const CONSULT_COST = 12;
export const POINTS_PER_STABILITY = 10;
export const CORRECT_POINTS = 100;
export const STREAK_BONUS = .25;
export const STREAK_CAP = 4;
export const STREAK_RESTORE = 2;
export const STABILITY_SCORE = 5;
export const RESTART_MS = 1200;
export const VICTORY_BEATS = Object.freeze([450, 1200, 1800, 2700, 3000, 3400, 3500]);
export const ACTS = Object.freeze(['I · BOOT', 'II · CALIBRATION', 'III · DEEP RECALL', 'FINALE']);

export function validateQuotes(data) {
  const fail = message => { throw new Error(`Invalid quotes: ${message}`); };
  const text = value => typeof value === 'string' && value.trim().length > 0;
  if (!data || data.version !== 1 || !data.bake || !Array.isArray(data.levels) || !data.levels.length) fail('version, bake or levels');
  for (const key of ['model', 'revision', 'mlxLm', 'algorithm']) if (!text(data.bake[key])) fail(`bake.${key}`);
  if (!Number.isInteger(data.bake.bosId) || data.bake.bosId < 0 || !Number.isInteger(data.bake.vocabSize) || data.bake.vocabSize <= data.bake.bosId || typeof data.bake.reviewed !== 'boolean') fail('bake metadata');
  const ids = new Set();
  let distractors;
  for (const level of data.levels) {
    if (!level || !text(level.id) || ids.has(level.id)) fail('level id');
    ids.add(level.id);
    if (!ACTS.includes(level.act) || !text(level.prefix) || !level.attribution || !text(level.attribution.speaker) || typeof level.attribution.work !== 'string' || !(level.attribution.year === null || typeof level.attribution.year === 'string' || Number.isInteger(level.attribution.year))) fail(`level ${level.id}`);
    if (!Array.isArray(level.steps) || !level.steps.length) fail('steps');
    for (const step of level.steps) {
      if (!step || typeof step.after !== 'string' || /[\p{L}\p{N}\s]/u.test(step.after) || !Array.isArray(step.exclude) || !step.exclude.every(text) || !Array.isArray(step.candidates) || step.candidates.length < 5) fail('step schema');
      distractors ??= step.candidates.length;
      if (step.candidates.length !== distractors || (data.bake.distractors !== undefined && data.bake.distractors !== distractors)) fail('inconsistent distractor count');
      const words = new Set();
      for (const option of [step.gold, ...step.candidates]) {
        if (!option || !text(option.word) || !/^\p{L}+(?:['’]\p{L}+)*$/u.test(option.word)) fail('word');
        const key = option.word.toLocaleLowerCase('en');
        if (words.has(key)) fail('duplicate choice');
        words.add(key);
        if (!Array.isArray(option.ids) || !option.ids.length || !option.ids.every(id => Number.isInteger(id) && id >= 0 && id < data.bake.vocabSize && id !== data.bake.bosId) || !Array.isArray(option.pieces) || option.ids.length !== option.pieces.length || !option.pieces.every(text)) fail('ids/pieces');
        if (!Number.isFinite(option.prob) || option.prob <= 0 || option.prob > 1) fail('probability');
      }
      if (step.candidates.some((c, i, a) => i && c.prob > a[i - 1].prob)) fail('candidate order');
    }
  }
  return data;
}

function random(seed) {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function choicesFor(data, levelIndex, stepIndex, attempt = 0) {
  const level = data.levels[levelIndex], step = level.steps[stepIndex];
  const seed = `${level.id}/${stepIndex}/${attempt}`;
  const rng = random(`${seed}/order`), choices = [step.gold, ...step.candidates];
  for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
  return { choices, startIndex: Math.floor(random(`${seed}/center`)() * choices.length) };
}
export function perfectScore(level) {
  return level.steps.reduce((total, _, i) => total + CORRECT_POINTS * (1 + STREAK_BONUS * Math.min(i, STREAK_CAP)), MAX_STABILITY * STABILITY_SCORE);
}
export function rankFor(score, perfect) {
  const ratio = perfect > 0 ? score / perfect : 0;
  return ratio >= .95 ? 'S' : ratio >= .85 ? 'A' : ratio >= .7 ? 'B' : ratio >= .5 ? 'C' : 'D';
}
export function createState(data, levelIndex = 0) {
  if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= data.levels.length) throw new RangeError('Invalid level index');
  const { choices, startIndex } = choicesFor(data, levelIndex, 0, 0);
  return { data, levelIndex, stepIndex: 0, attempt: 0, revision: 0, selectedIndex: startIndex, choices, stability: MAX_STABILITY, streak: 0, points: 0, consulted: false, rejected: [], phase: 'choosing', score: null, rank: null, events: [] };
}
export function reduce(state, action) {
  const noop = () => ({ ...state, events: [] });
  if (!action || action.revision !== state.revision) return noop();
  if (action.type === 'restart' && state.phase === 'shutdown') {
    const next = createState(state.data, state.levelIndex), attempt = state.attempt + 1;
    const { choices, startIndex } = choicesFor(state.data, state.levelIndex, 0, attempt);
    return { ...next, attempt, choices, selectedIndex: startIndex, revision: state.revision + 1 };
  }
  if (state.phase !== 'choosing') return noop();
  const next = { ...state, events: [], revision: state.revision + 1 };
  if (action.type === 'select') {
    if (!Number.isInteger(action.index) || !next.choices[action.index] || next.rejected.includes(next.choices[action.index].word) || action.index === next.selectedIndex) return noop();
    next.selectedIndex = action.index;
    return next;
  }
  if (action.type === 'consult') {
    if (state.consulted) return noop();
    next.consulted = true; next.stability -= CONSULT_COST; next.points -= CONSULT_COST * POINTS_PER_STABILITY;
    next.events.push({ type: 'consult' });
  } else if (action.type === 'lock') {
    const step = state.data.levels[state.levelIndex].steps[state.stepIndex];
    const choice = state.choices[state.selectedIndex];
    if (state.rejected.includes(choice.word)) return noop();
    if (choice.word !== step.gold.word) {
      const r = choice.prob / Math.max(...step.candidates.map(c => c.prob));
      const cost = r >= .25 ? WRONG_COSTS[0] : r >= .05 ? WRONG_COSTS[1] : WRONG_COSTS[2];
      next.stability -= cost; next.points -= POINTS_PER_STABILITY * cost; next.streak = 0;
      next.rejected = [...state.rejected, choice.word];
      next.events.push({ type: 'wrong', word: choice.word, cost, stepIndex: state.stepIndex });
    } else {
      next.streak++;
      const points = CORRECT_POINTS * (1 + STREAK_BONUS * Math.min(next.streak - 1, STREAK_CAP));
      next.points += points;
      if (next.streak >= 2) next.stability += STREAK_RESTORE;
      next.stepIndex++; next.consulted = false; next.rejected = [];
      next.events.push({ type: 'correct', word: choice.word, points, stepIndex: state.stepIndex });
      if (next.stepIndex === state.data.levels[state.levelIndex].steps.length) {
        next.stability = Math.min(MAX_STABILITY, next.stability);
        next.score = Math.max(0, next.points + STABILITY_SCORE * next.stability);
        next.rank = rankFor(next.score, perfectScore(state.data.levels[state.levelIndex]));
        next.phase = state.levelIndex === state.data.levels.length - 1 ? 'complete' : 'won';
        next.events.push({ type: 'won', score: next.score, rank: next.rank });
        if (next.phase === 'complete') next.events.push({ type: 'complete' });
      } else {
        const { choices, startIndex } = choicesFor(state.data, state.levelIndex, next.stepIndex, state.attempt);
        next.choices = choices; next.selectedIndex = startIndex;
      }
    }
  } else return noop();
  next.stability = Math.max(0, Math.min(MAX_STABILITY, next.stability));
  if (next.stability === 0) { next.phase = 'shutdown'; next.events.push({ type: 'shutdown' }); }
  return next;
}
