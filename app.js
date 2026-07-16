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
const SpeechRecognitionCtor = window.SpeechRecognition;
const WebkitSpeechRecognitionCtor = window.webkitSpeechRecognition;
const Recognition = SpeechRecognitionCtor || WebkitSpeechRecognitionCtor;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const app = document.querySelector('#root');

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
  mic: Recognition ? 'ready' : 'unsupported',
  timer: null,
  recognition: null,
  answered: false,
  lastError: '',
  logs: [],
};

function addLog(message) {
  const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  state.logs.push(`${time}  ${message}`);
  state.logs = state.logs.slice(-16);
}

addLog(`page loaded; secureContext=${window.isSecureContext}`);
addLog(`SpeechRecognition=${Boolean(SpeechRecognitionCtor)}`);
addLog(`webkitSpeechRecognition=${Boolean(WebkitSpeechRecognitionCtor)}`);
addLog(`mediaDevices=${Boolean(navigator.mediaDevices)}`);
addLog(`iOS=${isIOS}`);

const normalise = (value) => String(value || '')
  .toLowerCase()
  .replace(/[\s。、,.!?！？]/g, '')
  .trim();

function status() {
  return ({
    unsupported: '此瀏覽器沒有可用的語音辨識。',
    requesting: '正在請求麥克風權限…',
    listening: '正在聽，請現在唸出畫面上的假名',
    waiting: isIOS ? '請點「開始收音」，再唸出假名。' : '沒有收到語音，請再試一次。',
    error: `語音辨識失敗${state.lastError ? `（${state.lastError}）` : ''}。`,
    ready: isIOS ? 'iPhone Safari：每一題請點一次「開始收音」。' : '準備好麥克風後開始',
  })[state.mic] || '';
}

function stopRecognition() {
  try {
    if (state.recognition) {
      addLog('abort() called');
      state.recognition.abort();
    }
  } catch (error) {
    addLog(`abort exception: ${error.name || error}`);
  }
  state.recognition = null;
}

function debugPanel() {
  const rows = [
    ['SpeechRecognition', Boolean(SpeechRecognitionCtor)],
    ['webkitSpeechRecognition', Boolean(WebkitSpeechRecognitionCtor)],
    ['Secure context', window.isSecureContext],
    ['mediaDevices', Boolean(navigator.mediaDevices)],
    ['iPhone / iPad', isIOS],
    ['Mic state', state.mic],
  ];

  return `<details class="debug-panel" open>
    <summary>語音辨識 Debug</summary>
    <div class="debug-grid">${rows.map(([label, value]) => `<span>${label}</span><b>${String(value)}</b>`).join('')}</div>
    <pre>${state.logs.join('\n')}</pre>
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
  const listen = document.querySelector('[data-listen]');
  if (listen) listen.addEventListener('click', startRecognition);
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
    return `<section class="panel intro">
      <h2>看到假名，立刻唸出來</h2>
      <p>本局 20 題，只練習 あ・い・う・え・お。</p>
      <button class="primary" data-start ${state.mic === 'requesting' ? 'disabled' : ''}>${state.mic === 'requesting' ? '啟用麥克風中…' : '開始'}</button>
      <small>${status()}</small>
    </section>`;
  }

  if (state.phase === 'countdown') {
    return `<section class="panel countdown"><span>${state.countdown || 'START'}</span></section>`;
  }

  if (state.phase === 'playing') {
    const [kana] = state.round[state.index];
    const listenButton = Recognition && state.mic !== 'listening'
      ? `<button class="primary listen-button" data-listen>${state.mic === 'error' ? '重新開始收音' : '🎤 開始收音'}</button>`
      : '';

    return `<section class="game-layout">
      <div class="stats"><span>Score <b>${state.score}</b></span><span>Combo <b>${state.combo}</b></span><span>${state.index + 1} / ${TOTAL}</span></div>
      <div class="beat-card ${state.feedback.toLowerCase()}"><div class="pulse"></div><strong>${kana}</strong><p>${state.feedback || '唸出這個音'}</p>${state.heard ? `<small>聽到：${state.heard}</small>` : ''}</div>
      <p class="mic-status">🎤 ${status()}</p>
      ${listenButton}
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
    `SpeechRecognition=${Boolean(SpeechRecognitionCtor)}`,
    `webkitSpeechRecognition=${Boolean(WebkitSpeechRecognitionCtor)}`,
    `mediaDevices=${Boolean(navigator.mediaDevices)}`,
    `iOS=${isIOS}`,
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
  addLog('Start button tapped');
  state.mic = Recognition ? 'requesting' : 'unsupported';
  render();

  if (Recognition && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      addLog('getUserMedia requested');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      addLog(`getUserMedia success; tracks=${stream.getAudioTracks().length}`);
      stream.getTracks().forEach((track) => track.stop());
      state.mic = 'ready';
    } catch (error) {
      state.mic = 'error';
      state.lastError = `getUserMedia:${error.name || 'unknown'}`;
      addLog(`getUserMedia error: ${error.name || error}`);
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
  addLog(`prompt ${state.index + 1} begin`);
  state.answered = false;
  state.feedback = '';
  state.heard = '';
  state.lastError = '';
  clearTimeout(state.timer);
  stopRecognition();

  if (!Recognition) {
    state.mic = 'unsupported';
  } else if (isIOS) {
    state.mic = 'waiting';
  } else {
    state.mic = 'ready';
    setTimeout(startRecognition, 0);
  }
  render();
}

function startRecognition() {
  addLog('listen button / startRecognition invoked');
  if (!Recognition || state.answered) {
    addLog(`start blocked; Recognition=${Boolean(Recognition)} answered=${state.answered}`);
    render();
    return;
  }

  stopRecognition();
  clearTimeout(state.timer);
  state.mic = 'listening';
  state.lastError = '';
  render();

  let recognition;
  try {
    recognition = new Recognition();
    addLog('recognition object created');
  } catch (error) {
    state.mic = 'error';
    state.lastError = `constructor:${error.name || 'unknown'}`;
    addLog(`constructor error: ${error.name || error}`);
    render();
    return;
  }

  recognition.lang = 'ja-JP';
  recognition.interimResults = false;
  recognition.maxAlternatives = 5;
  recognition.continuous = false;
  recognition.onaudiostart = () => { addLog('event: audiostart'); render(); };
  recognition.onsoundstart = () => { addLog('event: soundstart'); render(); };
  recognition.onspeechstart = () => { addLog('event: speechstart'); render(); };
  recognition.onspeechend = () => { addLog('event: speechend'); render(); };
  recognition.onsoundend = () => { addLog('event: soundend'); render(); };
  recognition.onaudioend = () => { addLog('event: audioend'); render(); };
  recognition.onstart = () => { addLog('event: start'); render(); };
  recognition.onresult = (event) => {
    const alternatives = Array.from(event.results[0]).map((item) => item.transcript);
    addLog(`event: result => ${alternatives.join(' | ')}`);
    state.heard = alternatives[0] || '';
    const accepted = state.round[state.index][1];
    resolveBeat(alternatives.some((value) => accepted.includes(normalise(value))));
  };
  recognition.onerror = (event) => {
    addLog(`event: error => ${event.error || 'unknown'}; message=${event.message || ''}`);
    if (event.error !== 'aborted' && !state.answered) {
      state.mic = 'error';
      state.lastError = event.error || 'unknown';
      clearTimeout(state.timer);
      render();
    }
  };
  recognition.onnomatch = () => { addLog('event: nomatch'); render(); };
  recognition.onend = () => {
    addLog('event: end');
    if (!state.answered && state.mic === 'listening') {
      state.mic = 'waiting';
      clearTimeout(state.timer);
    }
    render();
  };

  state.recognition = recognition;
  try {
    addLog('calling recognition.start()');
    recognition.start();
    state.timer = setTimeout(() => {
      addLog('recognition timeout');
      if (!state.answered) resolveBeat(false);
    }, BEAT_MS * 5);
  } catch (error) {
    state.mic = 'error';
    state.lastError = `start:${error.name || 'unknown'}`;
    addLog(`start exception: ${error.name || error}`);
    render();
  }
}

function resolveBeat(ok) {
  if (state.answered) return;
  addLog(`resolveBeat(${ok})`);
  state.answered = true;
  stopRecognition();
  clearTimeout(state.timer);
  state.mic = Recognition ? 'ready' : 'unsupported';

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

render();