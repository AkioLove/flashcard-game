import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const KANA = [
  { kana: 'あ', accepted: ['あ', 'a', 'ア'] },
  { kana: 'い', accepted: ['い', 'i', 'イ'] },
  { kana: 'う', accepted: ['う', 'u', 'ウ'] },
  { kana: 'え', accepted: ['え', 'e', 'エ'] },
  { kana: 'お', accepted: ['お', 'o', 'オ'] },
];

const TOTAL = 20;
const BPM = 80;
const BEAT_MS = Math.round(60000 / BPM);
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

function makeRound() {
  return Array.from({ length: TOTAL }, () => KANA[Math.floor(Math.random() * KANA.length)]);
}

function normalise(value) {
  return value.toLowerCase().replace(/[\s。、,.!?！？]/g, '').trim();
}

function App() {
  const [phase, setPhase] = useState('idle');
  const [countdown, setCountdown] = useState(3);
  const [round] = useState(makeRound);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [heard, setHeard] = useState('');
  const [micState, setMicState] = useState(Recognition ? 'ready' : 'unsupported');
  const recognitionRef = useRef(null);
  const answeredRef = useRef(false);
  const beatTimerRef = useRef(null);

  const current = round[index];

  useEffect(() => () => {
    clearTimeout(beatTimerRef.current);
    stopRecognition();
  }, []);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown === 0) {
      setPhase('playing');
      return;
    }
    const timer = setTimeout(() => setCountdown((value) => value - 1), 700);
    return () => clearTimeout(timer);
  }, [phase, countdown]);

  useEffect(() => {
    if (phase !== 'playing') return;
    beginBeat();
    return () => stopRecognition();
  }, [phase, index]);

  function stopRecognition() {
    try { recognitionRef.current?.abort(); } catch {}
    recognitionRef.current = null;
  }

  function beginBeat() {
    answeredRef.current = false;
    setFeedback('');
    setHeard('');
    setMicState(Recognition ? 'listening' : 'unsupported');
    clearTimeout(beatTimerRef.current);

    if (Recognition) {
      const recognition = new Recognition();
      recognition.lang = 'ja-JP';
      recognition.interimResults = false;
      recognition.maxAlternatives = 5;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        const alternatives = Array.from(event.results[0]).map((item) => item.transcript);
        setHeard(alternatives[0] || '');
        const matched = alternatives.some((value) => current.accepted.includes(normalise(value)));
        resolveBeat(matched);
      };
      recognition.onerror = (event) => {
        if (event.error !== 'aborted') setMicState('error');
      };
      recognition.onend = () => {
        if (!answeredRef.current) setMicState('waiting');
      };
      recognitionRef.current = recognition;
      try { recognition.start(); } catch { setMicState('error'); }
    }

    beatTimerRef.current = setTimeout(() => {
      if (!answeredRef.current) resolveBeat(false);
    }, BEAT_MS * 2);
  }

  function resolveBeat(isCorrect) {
    if (answeredRef.current) return;
    answeredRef.current = true;
    stopRecognition();
    clearTimeout(beatTimerRef.current);
    setMicState(Recognition ? 'ready' : 'unsupported');

    if (isCorrect) {
      const nextCombo = combo + 1;
      setCorrect((value) => value + 1);
      setCombo(nextCombo);
      setBestCombo((value) => Math.max(value, nextCombo));
      setScore((value) => value + 100 + Math.min(nextCombo * 10, 200));
      setFeedback('Correct');
    } else {
      setCombo(0);
      setFeedback('Wrong');
    }

    setTimeout(() => {
      if (index + 1 >= TOTAL) setPhase('finished');
      else setIndex((value) => value + 1);
    }, 450);
  }

  async function startGame() {
    setMicState(Recognition ? 'requesting' : 'unsupported');

    if (Recognition && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        setMicState('ready');
      } catch {
        setMicState('error');
      }
    }

    setCountdown(3);
    setPhase('countdown');
  }

  function restart() {
    window.location.reload();
  }

  const statusText = useMemo(() => {
    if (micState === 'unsupported') return '此瀏覽器沒有可用的語音辨識，仍可用下方按鈕測試遊戲。';
    if (micState === 'requesting') return '正在請求麥克風權限…';
    if (micState === 'listening') return '正在聽，請唸出畫面上的假名';
    if (micState === 'waiting') return '沒有收到語音，請再唸一次或使用手動判定。';
    if (micState === 'error') return '麥克風或語音辨識失敗，可用手動判定。';
    if (isIOS) return 'iPhone Safari：按開始後請允許麥克風。';
    return '準備好麥克風後開始';
  }, [micState]);

  return (
    <main className="app-shell">
      <header>
        <p className="eyebrow">80 BPM · vowel challenge</p>
        <h1>Kana Beat</h1>
      </header>

      {phase === 'idle' && (
        <section className="panel intro">
          <h2>看到假名，立刻唸出來</h2>
          <p>本局 20 題，只練習 あ・い・う・え・お。</p>
          <button className="primary" onClick={startGame} disabled={micState === 'requesting'}>
            {micState === 'requesting' ? '啟用麥克風中…' : '開始'}
          </button>
          <small>{statusText}</small>
        </section>
      )}

      {phase === 'countdown' && (
        <section className="panel countdown" aria-live="polite">
          <span>{countdown || 'START'}</span>
        </section>
      )}

      {phase === 'playing' && (
        <section className="game-layout">
          <div className="stats">
            <span>Score <b>{score}</b></span>
            <span>Combo <b>{combo}</b></span>
            <span>{index + 1} / {TOTAL}</span>
          </div>
          <div className={`beat-card ${feedback ? feedback.toLowerCase() : ''}`}>
            <div className="pulse" />
            <strong>{current.kana}</strong>
            <p>{feedback || '唸出這個音'}</p>
            {heard && <small>聽到：{heard}</small>}
          </div>
          <p className="mic-status">🎤 {statusText}</p>
          <div className="fallback-actions">
            <button onClick={() => resolveBeat(true)}>手動：正確</button>
            <button onClick={() => resolveBeat(false)}>手動：錯誤</button>
          </div>
        </section>
      )}

      {phase === 'finished' && (
        <section className="panel result">
          <p className="eyebrow">Result</p>
          <h2>{correct} / {TOTAL}</h2>
          <dl>
            <div><dt>分數</dt><dd>{score}</dd></div>
            <div><dt>命中率</dt><dd>{Math.round((correct / TOTAL) * 100)}%</dd></div>
            <div><dt>最高 Combo</dt><dd>{bestCombo}</dd></div>
          </dl>
          <button className="primary" onClick={restart}>再玩一次</button>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
