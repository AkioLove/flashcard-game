import { AudioRecorder, canRecordAudio } from './recorder.ts';
import { speechEngine } from './speech.ts';
import { canonicalVowel } from './kana-normalize.js';

const KANA = [
  ['あ', ['あ', 'ア', 'a']],
  ['い', ['い', 'イ', 'i']],
  ['う', ['う', 'ウ', 'u']],
  ['え', ['え', 'エ', 'e']],
  ['お', ['お', 'オ', 'o']],
];

const TOTAL = 20;
const BPM = 80;
const BEAT_MS = Math.round(60000 / BPM);
const RECORDING_MS = Math.max(1800, BEAT_MS * 2);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const localSpeechSupported = Boolean(canRecordAudio() && window.Worker && window.WebAssembly);
const app = document.querySelector('#root');
const recorder = new AudioRecorder();
const speechVocabulary = [...new Set(KANA.map(([kana]) => kana))];
speechEngine.setVocabulary(speechVocabulary);

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
  mic: localSpeechSupported ? 'ready' : 'unsupported',
  timer: null,
  answered: false,
  speechReady: false,
  modelProgress: null,
  modelStatus: null,
  beatId: 0,
  lastError: '',
  logs: [],
};

function addLog(message) {
  const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  state.logs.push(`${time}  ${message}`);
  state.logs = state.logs.slice(-16);
}

addLog(`page loaded; secureContext=${window.isSecureContext}`);
addLog(`MediaRecorder=${Boolean(window.MediaRecorder)}`);
addLog(`AudioContext=${Boolean(window.AudioContext)}`);
addLog(`WebAssembly=${Boolean(window.WebAssembly)}`);
addLog(`iOS=${isIOS}`);
speechEngine.setDiagnosticListener((message) => addLog(message));

speechEngine.setProgressListener((progress) => {
  if (state.mic !== 'loading-model') return;
  const statusChanged = state.modelStatus !== progress.status;
  state.modelStatus = progress.status;
  const next = Number.isFinite(progress.progress) ? Math.floor(progress.progress) : null;
  const progressChanged = next !== null && next !== state.modelProgress;
  if (progressChanged) {
    state.modelProgress = next;
  }
  if (statusChanged || progressChanged) {
    render();
  }
});

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]);
}

function status() {
  return ({
    unsupported: '此瀏覽器沒有可用的本機語音辨識。',
    requesting: '正在請求麥克風權限…',
    'loading-model': state.modelStatus === 'initializing'
      ? '模型下載完成，正在初始化 Vosk 辨識核心…'
      : `正在下載日文語音模型${state.modelProgress === null ? '…' : `（${state.modelProgress}%）`}`,
    arming: '正在準備錄音，看到「現在唸！」再開口',
    recording: '正在錄音，請現在唸出畫面上的假名',
    transcribing: '正在手機內辨識語音…',
    error: `本機語音辨識失敗${state.lastError ? `（${state.lastError}）` : ''}。`,
    ready: isIOS ? 'iPhone Safari：按開始後請允許麥克風，語音只在手機內處理。' : '語音只在此裝置內處理',
  })[state.mic] || '';
}

function debugPanel() {
  const rows = [
    ['MediaRecorder', Boolean(window.MediaRecorder)],
    ['AudioContext', Boolean(window.AudioContext)],
    ['WebAssembly', Boolean(window.WebAssembly)],
    ['Secure context', window.isSecureContext],
    ['mediaDevices', Boolean(navigator.mediaDevices)],
    ['iPhone / iPad', isIOS],
    ['Model ready', state.speechReady],
    ['Model stage', state.modelStatus || 'idle'],
    ['Mic state', state.mic],
  ];

  return `<details class="debug-panel" open>
    <summary>本機語音辨識 Debug</summary>
    <div class="debug-grid">${rows.map(([label, value]) => `<span>${label}</span><b>${String(value)}</b>`).join('')}</div>
    <pre>${escapeHtml(state.logs.join('\n'))}</pre>
    <button type="button" data-copy-debug>複製 Debug 資訊</button>
  </details>`;
}

function render() {
  app.innerHTML = `<main class="app-shell">
    <header><p class="eyebrow">80 BPM · vowel challenge</p><h1>Kana Beat</h1></header>
    ${screen()}
    ${debugPanel()}
  </main>`;

  const start = document.querySelector('[data-start]');
  if (start) start.addEventListener('click', startGame);
  const correct = document.querySelector('[data-correct]');
  if (correct) correct.addEventListener('click', () => resolveBeat(true));
  const wrong = document.querySelector('[data-wrong]');
  if (wrong) wrong.addEventListener('click', () => resolveBeat(false));
  const restart = document.querySelector('[data-restart]');
  if (restart) restart.addEventListener('click', () => location.reload());
  const copy = document.querySelector('[data-copy-debug]');
  if (copy) copy.addEventListener('click', copyDebug);
}

function screen() {
  if (state.phase === 'idle') {
    const starting = ['requesting', 'loading-model'].includes(state.mic);
    return `<section class="panel intro">
      <h2>看到假名，立刻唸出來</h2>
      <p>本局 20 題，只練習 あ・い・う・え・お。</p>
      <button class="primary" data-start ${starting ? 'disabled' : ''}>${starting ? '準備本機語音中…' : '開始'}</button>
      <small>${escapeHtml(status())}</small>
    </section>`;
  }

  if (state.phase === 'countdown') {
    return `<section class="panel countdown"><span>${state.countdown || 'START'}</span></section>`;
  }

  if (state.phase === 'playing') {
    const [kana] = state.round[state.index];
    const listening = state.mic === 'recording';
    const instruction = state.feedback
      || (listening ? '現在唸！' : state.mic === 'transcribing' ? '辨識中…' : '準備…');
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
    `MediaRecorder=${Boolean(window.MediaRecorder)}`,
    `AudioContext=${Boolean(window.AudioContext)}`,
    `WebAssembly=${Boolean(window.WebAssembly)}`,
    `mediaDevices=${Boolean(navigator.mediaDevices)}`,
    `iOS=${isIOS}`,
    `modelReady=${state.speechReady}`,
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
  if (['requesting', 'loading-model'].includes(state.mic)) return;
  addLog('Start button tapped');

  if (localSpeechSupported) {
    state.mic = 'requesting';
    state.lastError = '';
    render();
    try {
      await recorder.requestPermission();
      addLog('microphone permission granted; stream kept warm');
      state.mic = 'loading-model';
      state.modelProgress = null;
      state.modelStatus = 'downloading';
      render();
      await speechEngine.initialize();
      state.speechReady = true;
      state.mic = 'ready';
      addLog(`Vosk ready; vocabulary=${speechVocabulary.length}`);
    } catch (error) {
      await recorder.dispose();
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
  state.beatId += 1;
  const beatId = state.beatId;
  addLog(`prompt ${state.index + 1} begin`);
  state.answered = false;
  state.feedback = '';
  state.heard = '';
  state.lastError = '';
  clearTimeout(state.timer);

  if (!localSpeechSupported) state.mic = 'unsupported';
  else if (!state.speechReady) state.mic = 'error';
  else state.mic = 'arming';
  render();

  if (state.speechReady) void startRecording(beatId);
}

async function startRecording(beatId) {
  try {
    const requestedAt = performance.now();
    await recorder.start();
    if (beatId !== state.beatId || state.answered) {
      await recorder.cancel();
      return;
    }
    state.mic = 'recording';
    addLog(`recording started; latency=${Math.round(performance.now() - requestedAt)}ms`);
    render();
    state.timer = setTimeout(() => void finishRecording(beatId), RECORDING_MS);
  } catch (error) {
    if (beatId !== state.beatId || state.answered) return;
    state.mic = 'error';
    state.lastError = `record:${error.name || 'unknown'}`;
    addLog(`recording error: ${error.message || error}`);
    render();
  }
}

async function finishRecording(beatId) {
  try {
    const blob = await recorder.stop();
    if (beatId !== state.beatId || state.answered) return;
    addLog(`recording stopped; bytes=${blob.size}; type=${blob.type}`);
    state.mic = 'transcribing';
    render();

    const text = await speechEngine.transcribe(blob);
    if (beatId !== state.beatId || state.answered) return;
    state.heard = text;
    addLog(`local result => ${text || '(silence)'}`);
    const expected = canonicalVowel(state.round[state.index][0]);
    resolveBeat(canonicalVowel(text) === expected);
  } catch (error) {
    if (beatId !== state.beatId || state.answered) return;
    state.mic = 'error';
    state.lastError = `transcribe:${error.name || 'unknown'}`;
    addLog(`transcription error: ${error.message || error}`);
    render();
  }
}

function resolveBeat(ok) {
  if (state.answered) return;
  addLog(`resolveBeat(${ok})`);
  state.answered = true;
  clearTimeout(state.timer);
  const recorderReady = recorder.cancel();
  state.mic = state.speechReady ? 'ready' : (localSpeechSupported ? 'error' : 'unsupported');

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

  setTimeout(async () => {
    await recorderReady;
    state.index += 1;
    if (state.index >= TOTAL) {
      state.phase = 'finished';
      await recorder.dispose();
      render();
    } else {
      beginBeat();
    }
  }, 450);
}

window.addEventListener('pagehide', () => void recorder.dispose());
render();
