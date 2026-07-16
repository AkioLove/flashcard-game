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
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const speechSupported = canRecognizeSpeech();
const app = document.querySelector('#root');
const speechVocabulary = [...new Set(KANA.flatMap(([, aliases]) => aliases))];
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
  mic: speechSupported ? 'ready' : 'unsupported',
  answered: false,
  speechReady: false,
  beatId: 0,
  lastError: '',
  logs: [],
};

function addLog(message) {
  const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  state.logs.push(`${time}  ${message}`);
  state.logs = state.logs.slice(-24);
}

addLog(`page loaded; secureContext=${window.isSecureContext}`);
addLog(`SpeechRecognition=${speechSupported}; implementation=${recognitionImplementation()}`);
addLog(`iOS=${isIOS}`);

speechEngine.setEventListener((event) => {
  addLog(`speech:${event.phase}:${event.type}${event.detail ? ` => ${event.detail}` : ''}`);

  if (event.phase !== 'recognize' || state.phase !== 'playing' || state.answered) return;
  if (event.type === 'audiostart') state.mic = 'recording';
  if (['speechend', 'audioend', 'stop'].includes(event.type)) state.mic = 'transcribing';
  render();
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
    arming: '正在啟動辨識，看到「現在唸！」再開口',
    recording: '瀏覽器已開始收音，請現在唸出畫面上的假名',
    transcribing: '正在等待瀏覽器回傳辨識結果…',
    error: `瀏覽器語音辨識失敗${state.lastError ? `（${state.lastError}）` : ''}。`,
    ready: isIOS
      ? 'iPhone：請允許語音辨識與麥克風；Chrome 仍受 iOS WebKit 支援狀況影響。'
      : '使用瀏覽器內建語音辨識，不需下載模型或 API Key。',
  })[state.mic] || '';
}

function debugPanel() {
  const rows = [
    ['SpeechRecognition', speechSupported],
    ['Implementation', recognitionImplementation()],
    ['Secure context', window.isSecureContext],
    ['mediaDevices', Boolean(navigator.mediaDevices)],
    ['iPhone / iPad', isIOS],
    ['Speech ready', state.speechReady],
    ['Mic state', state.mic],
  ];

  return `<details class="debug-panel" open>
    <summary>Web Speech API Debug</summary>
    <div class="debug-grid">${rows.map(([label, value]) => `<span>${label}</span><b>${String(value)}</b>`).join('')}</div>
    <pre>${escapeHtml(state.logs.join('\n'))}</pre>
    <button type="button" data-copy-debug>複製 Debug 資訊</button>
  </details>`;
}

function render() {
  app.innerHTML = `<main class="app-shell">
    <header><p class="eyebrow">${BPM} BPM · vowel challenge</p><h1>Kana Beat</h1></header>
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
    const starting = state.mic === 'requesting';
    return `<section class="panel intro">
      <h2>看到假名，立刻唸出來</h2>
      <p>本局 20 題，只練習 あ・い・う・え・お。</p>
      <button class="primary" data-start ${starting ? 'disabled' : ''}>${starting ? '準備語音辨識中…' : '開始'}</button>
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
    `SpeechRecognition=${speechSupported}`,
    `implementation=${recognitionImplementation()}`,
    `mediaDevices=${Boolean(navigator.mediaDevices)}`,
    `iOS=${isIOS}`,
    `speechReady=${state.speechReady}`,
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
      state.mic = 'ready';
      addLog(`Web Speech ready; lang=ja-JP; vocabulary=${speechVocabulary.length}`);
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
  state.beatId += 1;
  const beatId = state.beatId;
  addLog(`prompt ${state.index + 1} begin`);
  state.answered = false;
  state.feedback = '';
  state.heard = '';
  state.lastError = '';

  if (!speechSupported) state.mic = 'unsupported';
  else if (!state.speechReady) state.mic = 'error';
  else state.mic = 'arming';
  render();

  if (state.speechReady) void recognizeBeat(beatId);
}

async function recognizeBeat(beatId) {
  try {
    const requestedAt = performance.now();
    const result = await speechEngine.recognize();
    if (beatId !== state.beatId || state.answered) return;
    state.mic = 'transcribing';

    const ranked = result.alternatives;
    const expected = canonicalVowel(state.round[state.index][0]);
    const decision = matchVowelCandidates(expected, ranked);
    const selected = decision.candidate
      || ranked.find((alternative) => recognitionVowel(alternative.transcript))
      || ranked[0]
      || { transcript: result.transcript, confidence: null, final: false, rank: 0 };
    state.heard = selected.transcript;

    const candidates = ranked.map((alternative) => {
      const confidence = alternative.confidence === null ? 'n/a' : alternative.confidence.toFixed(3);
      return `${alternative.transcript} (${confidence}${alternative.final ? ', final' : ', interim'})`;
    }).join(' | ');
    addLog(`result ${Math.round(performance.now() - requestedAt)}ms => ${candidates || '(silence)'}`);
    addLog(`decision expected=${expected}; matched=${decision.matched}; candidateRank=${decision.rank === null ? 'n/a' : decision.rank + 1}; mode=${decision.mode}`);
    resolveBeat(decision.matched);
  } catch (error) {
    if (beatId !== state.beatId || state.answered) return;
    state.mic = 'error';
    state.lastError = error.message || error.name || 'unknown';
    addLog(`recognition error: ${error.message || error}`);
    render();
    resolveBeat(false);
  }
}

function resolveBeat(ok) {
  if (state.answered) return;
  addLog(`resolveBeat(${ok})`);
  state.answered = true;
  speechEngine.abort();
  state.mic = state.speechReady ? 'ready' : (speechSupported ? 'error' : 'unsupported');

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

  setTimeout(() => {
    state.index += 1;
    if (state.index >= TOTAL) {
      state.phase = 'finished';
      render();
    } else {
      beginBeat();
    }
  }, 450);
}

window.addEventListener('pagehide', () => speechEngine.abort());
render();
