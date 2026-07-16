import { canRecognizeSpeech, recognitionImplementation, speechEngine } from './speech.ts';
import { canonicalVowel, matchVowelCandidates, recognitionVowel } from './kana-normalize.js';

const KANA = [
  ['あ', ['あ', 'ア', 'a']],
  ['い', ['い', 'イ', 'i']],
  ['う', ['う', 'ウ', 'u']],
  ['え', ['え', 'エ', 'e']],
  ['お', ['お', 'オ', 'o']],
];

const TOTAL = 20;
const BPM = 80;
const BEAT_MS = Math.round(60_000 / BPM);
const PROMPT_BEATS = 2;
const PROMPT_MS = BEAT_MS * PROMPT_BEATS;
const FEEDBACK_MS = 300;
const ANSWER_WINDOW_MS = PROMPT_MS - FEEDBACK_MS;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const speechSupported = canRecognizeSpeech();
const app = document.querySelector('#root');
const speechVocabulary = [...new Set(KANA.flatMap(([, aliases]) => aliases))];
speechEngine.setVocabulary(speechVocabulary);

let answerTimer = 0;
let advanceTimer = 0;
let utteranceBeatId = null;

let state = {
  phase: 'idle',
  round: [],
  index: 0,
  score: 0,
  combo: 0,
  best: 0,
  correct: 0,
  feedback: '',
  heard: '',
  mic: speechSupported ? 'ready' : 'unsupported',
  answered: false,
  speechReady: false,
  streamReady: false,
  streamFatal: false,
  beatId: 0,
  lastError: '',
  logs: [],
  debugOpen: false,
};

function addLog(message) {
  const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  state.logs.push(`${time}  ${message}`);
  state.logs = state.logs.slice(-32);
}

function renderIfPlaying() {
  if (state.phase === 'playing') render();
}

addLog(`page loaded; secureContext=${window.isSecureContext}`);
addLog(`SpeechRecognition=${speechSupported}; implementation=${recognitionImplementation()}`);
addLog(`iOS=${isIOS}; prompt=${PROMPT_MS}ms; answerWindow=${ANSWER_WINDOW_MS}ms`);

speechEngine.setEventListener((event) => {
  if (event.type !== 'result') {
    addLog(`speech:${event.phase}:${event.type}${event.detail ? ` => ${event.detail}` : ''}`);
  }
  if (event.phase !== 'stream') return;

  let shouldRender = false;
  if (event.type === 'audiostart') {
    state.streamReady = true;
    state.streamFatal = false;
    const nextMic = state.phase === 'playing' && !state.answered ? 'recording' : 'ready';
    shouldRender = state.mic !== nextMic;
    state.mic = nextMic;
  } else if (event.type === 'speechstart' || (event.type === 'soundstart' && utteranceBeatId === null)) {
    utteranceBeatId = state.phase === 'playing' ? state.beatId : 0;
    if (state.phase === 'playing' && !state.answered && state.mic !== 'recording') {
      state.mic = 'recording';
      shouldRender = true;
    }
  } else if (event.type === 'audioend' || event.type === 'end' || event.type === 'restart') {
    state.streamReady = false;
    const nextMic = state.streamFatal ? 'error' : (state.phase === 'playing' ? 'arming' : 'ready');
    shouldRender = state.mic !== nextMic;
    state.mic = nextMic;
  } else if (event.type === 'error') {
    state.lastError = event.detail || 'unknown';
    if (!/no-speech|aborted/.test(state.lastError)) {
      state.streamFatal = /not-allowed|service-not-allowed|audio-capture|language-not-supported/.test(state.lastError);
      shouldRender = state.mic !== 'error';
      state.mic = 'error';
    }
  }

  if (shouldRender) renderIfPlaying();
});

speechEngine.setResultListener((result) => {
  const targetBeatId = utteranceBeatId ?? state.beatId;
  if (result.final) utteranceBeatId = null;

  if (state.phase !== 'playing') {
    addLog(`stream result ignored outside game; final=${result.final}`);
    return;
  }
  if (targetBeatId !== state.beatId) {
    addLog(`stream result stale; targetBeat=${targetBeatId}; currentBeat=${state.beatId}`);
    return;
  }
  if (state.answered) {
    addLog(`stream result ignored; beat=${state.beatId} already resolved`);
    return;
  }

  const ranked = result.alternatives;
  const expected = canonicalVowel(state.round[state.index][0]);
  const decision = matchVowelCandidates(expected, ranked);
  const selected = decision.candidate
    || ranked.find((alternative) => recognitionVowel(alternative.transcript))
    || ranked[0]
    || { transcript: result.transcript, confidence: null, final: result.final, rank: 0 };
  const previousHeard = state.heard;
  state.heard = selected.transcript;

  const candidates = ranked.map((alternative) => {
    const confidence = alternative.confidence === null ? 'n/a' : alternative.confidence.toFixed(3);
    return `${alternative.transcript} (${confidence}${alternative.final ? ', final' : ', interim'})`;
  }).join(' | ');
  addLog(`stream result beat=${state.beatId}; session=${result.sessionId} => ${candidates || '(silence)'}`);
  addLog(`decision expected=${expected}; matched=${decision.matched}; candidateRank=${decision.rank === null ? 'n/a' : decision.rank + 1}; mode=${decision.mode}`);

  if (decision.matched) resolveBeat(true, 'speech');
  else if (state.heard !== previousHeard) render();
});

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]);
}

function status() {
  return ({
    unsupported: '此瀏覽器沒有 Web Speech API，仍可使用手動按鈕。',
    requesting: '正在啟用瀏覽器語音辨識…',
    arming: '持續辨識正在連線；遊戲節拍不會等待',
    recording: `持續收音中；每題固定 ${PROMPT_BEATS} 拍`,
    error: `瀏覽器語音辨識失敗${state.lastError ? `（${state.lastError}）` : ''}；遊戲仍會照固定節拍前進。`,
    ready: isIOS
      ? 'iPhone：整局持續收音，辨識服務中斷時會自動重連。'
      : '整局持續收音，不需下載模型或 API Key。',
  })[state.mic] || '';
}

function debugPanel() {
  const rows = [
    ['SpeechRecognition', speechSupported],
    ['Implementation', recognitionImplementation()],
    ['Secure context', window.isSecureContext],
    ['iPhone / iPad', isIOS],
    ['Speech ready', state.speechReady],
    ['Stream ready', state.streamReady],
    ['Fatal stream error', state.streamFatal],
    ['Prompt window', `${PROMPT_MS} ms (${PROMPT_BEATS} beats)`],
    ['Mic state', state.mic],
  ];

  return `<details class="debug-panel" ${state.debugOpen ? 'open' : ''}>
    <summary>Streaming Web Speech Debug</summary>
    <div class="debug-grid">${rows.map(([label, value]) => `<span>${label}</span><b>${String(value)}</b>`).join('')}</div>
    <pre>${escapeHtml(state.logs.join('\n'))}</pre>
    <button type="button" data-copy-debug>複製 Debug 資訊</button>
  </details>`;
}

function render() {
  app.innerHTML = `<main class="app-shell">
    <header><p class="eyebrow">${BPM} BPM · ${PROMPT_BEATS} beats per kana</p><h1>Kana Beat</h1></header>
    ${screen()}
    ${debugPanel()}
  </main>`;

  const start = document.querySelector('[data-start]');
  if (start) start.addEventListener('click', startGame);
  const correct = document.querySelector('[data-correct]');
  if (correct) correct.addEventListener('click', () => resolveBeat(true, 'manual'));
  const wrong = document.querySelector('[data-wrong]');
  if (wrong) wrong.addEventListener('click', () => resolveBeat(false, 'manual'));
  const restart = document.querySelector('[data-restart]');
  if (restart) restart.addEventListener('click', () => location.reload());
  const copy = document.querySelector('[data-copy-debug]');
  if (copy) copy.addEventListener('click', copyDebug);
  const debug = document.querySelector('.debug-panel');
  if (debug) debug.addEventListener('toggle', () => {
    state.debugOpen = debug.open;
  });
}

function screen() {
  if (state.phase === 'idle') {
    const starting = state.mic === 'requesting';
    return `<section class="panel intro">
      <h2>看到假名，立刻唸出來</h2>
      <p>本局 20 題，每個假名固定 ${PROMPT_BEATS} 拍。</p>
      <button class="primary" data-start ${starting ? 'disabled' : ''}>${starting ? '準備持續辨識中…' : '開始'}</button>
      <small>${escapeHtml(status())}</small>
    </section>`;
  }

  if (state.phase === 'countdown') {
    return `<section class="panel countdown"><span>${state.countdown || 'START'}</span></section>`;
  }

  if (state.phase === 'playing') {
    const [kana] = state.round[state.index];
    const listening = !state.answered && state.mic === 'recording';
    const instruction = state.feedback
      || (listening ? (state.heard ? '再試一次！' : '現在唸！') : '語音連線中…');
    return `<section class="game-layout">
      <div class="stats"><span>Score <b>${state.score}</b></span><span>Combo <b>${state.combo}</b></span><span>${state.index + 1} / ${TOTAL}</span></div>
      <div class="beat-card ${state.feedback.toLowerCase()} ${listening ? 'listening' : ''}"><div class="pulse"></div><strong>${kana}</strong><p>${instruction}</p>${state.heard ? `<small>聽到：${escapeHtml(state.heard)}</small>` : ''}</div>
      <p class="mic-status">🎤 ${escapeHtml(status())}</p>
      <div class="fallback-actions"><button data-correct>手動：正確</button><button data-wrong>手動：錯誤</button></div>
    </section>`;
  }

  return `<section class="panel result">
    <p class="eyebrow">Result</p><h2>${state.correct} / ${TOTAL}</h2>
    <dl><div><dt>分數</dt><dd>${state.score}</dd></div><div><dt>命中率</dt><dd>${Math.round(state.correct / TOTAL * 100)}%</dd></div><div><dt>最高 Combo</dt><dd>${state.best}</dd></div></dl>
    <button class="primary" data-restart>再玩一次</button>
  </section>`;
}

async function copyDebug() {
  const text = [
    `userAgent=${navigator.userAgent}`,
    `secureContext=${window.isSecureContext}`,
    `SpeechRecognition=${speechSupported}`,
    `implementation=${recognitionImplementation()}`,
    `iOS=${isIOS}`,
    `speechReady=${state.speechReady}`,
    `streamReady=${state.streamReady}`,
    `promptMs=${PROMPT_MS}`,
    ...state.logs,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    addLog('debug copied');
  } catch (error) {
    addLog(`copy failed: ${error.name || error}`);
  }
  render();
}

async function startGame() {
  if (state.mic === 'requesting') return;
  addLog('Start button tapped');

  if (speechSupported) {
    state.mic = 'requesting';
    state.lastError = '';
    render();
    try {
      await speechEngine.initialize();
      state.speechReady = true;
      state.mic = 'arming';
      speechEngine.startListening();
      addLog(`continuous Web Speech started; lang=ja-JP; vocabulary=${speechVocabulary.length}`);
    } catch (error) {
      state.mic = 'error';
      state.lastError = error.message || error.name || 'unknown';
      addLog(`speech setup error: ${error.message || error}`);
    }
  }

  state.round = Array.from({ length: TOTAL }, () => KANA[Math.floor(Math.random() * KANA.length)]);
  state.phase = 'countdown';
  state.countdown = 3;
  render();

  const id = setInterval(() => {
    state.countdown -= 1;
    render();
    if (state.countdown === 0) {
      clearInterval(id);
      setTimeout(() => {
        state.phase = 'playing';
        beginBeat();
      }, 250);
    }
  }, 700);
}

function beginBeat() {
  window.clearTimeout(answerTimer);
  window.clearTimeout(advanceTimer);
  state.beatId += 1;
  const beatId = state.beatId;
  addLog(`prompt ${state.index + 1} begin; beatId=${beatId}; deadline=${ANSWER_WINDOW_MS}ms`);
  state.answered = false;
  state.feedback = '';
  state.heard = '';
  state.lastError = '';

  if (!speechSupported) state.mic = 'unsupported';
  else if (!state.speechReady) state.mic = 'error';
  else if (state.streamFatal) state.mic = 'error';
  else state.mic = state.streamReady ? 'recording' : 'arming';
  render();

  answerTimer = window.setTimeout(() => resolveBeat(false, 'deadline'), ANSWER_WINDOW_MS);
  advanceTimer = window.setTimeout(() => advanceBeat(beatId), PROMPT_MS);
}

function resolveBeat(ok, source = 'unknown') {
  if (state.answered) return;
  addLog(`resolveBeat(${ok}); source=${source}; beatId=${state.beatId}`);
  state.answered = true;
  window.clearTimeout(answerTimer);

  if (ok) {
    state.correct += 1;
    state.combo += 1;
    state.best = Math.max(state.best, state.combo);
    state.score += 100 + Math.min(state.combo * 10, 200);
    state.feedback = 'Correct';
  } else {
    state.combo = 0;
    state.feedback = 'Wrong';
  }
  render();
}

function advanceBeat(beatId) {
  if (beatId !== state.beatId || state.phase !== 'playing') return;
  if (!state.answered) resolveBeat(false, 'advance');

  state.index += 1;
  if (state.index >= TOTAL) {
    state.phase = 'finished';
    state.streamReady = false;
    state.mic = state.speechReady ? 'ready' : state.mic;
    speechEngine.stopListening();
    render();
  } else {
    beginBeat();
  }
}

window.addEventListener('pagehide', () => speechEngine.stopListening());
render();
