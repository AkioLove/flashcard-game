const KANA=[['あ',['あ','ア','a']],['い',['い','イ','i']],['う',['う','ウ','u']],['え',['え','エ','e']],['お',['お','オ','o']]];
const TOTAL=20,BPM=80,BEAT_MS=Math.round(60000/BPM),Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const app=document.querySelector('#root');
let state={phase:'idle',round:[],index:0,score:0,combo:0,best:0,correct:0,feedback:'',heard:'',mic:Recognition?'ready':'unsupported',timer:null,recognition:null,answered:false,lastError:''};
const normalise=v=>String(v||'').toLowerCase().replace(/[\s。、,.!?！？]/g,'').trim();
const status=()=>({unsupported:'此瀏覽器沒有可用的語音辨識，仍可用手動按鈕測試。',requesting:'正在請求麥克風權限…',listening:'正在聽，請現在唸出畫面上的假名',waiting:isIOS?'請點「開始收音」，再唸出假名。':'沒有收到語音，請再試一次。',error:`語音辨識失敗${state.lastError?`（${state.lastError}）`:''}，請再試一次或用手動判定。`,ready:isIOS?'iPhone Safari：每一題請點一次「開始收音」。':'準備好麥克風後開始'}[state.mic]||'');
function stopRecognition(){try{if(state.recognition)state.recognition.abort()}catch(e){}state.recognition=null}
function render(){
  app.innerHTML=`<main class="app-shell"><header><p class="eyebrow">80 BPM · vowel challenge</p><h1>Kana Beat</h1></header>${screen()}</main>`;
  const start=document.querySelector('[data-start]');if(start)start.addEventListener('click',startGame);
  const listen=document.querySelector('[data-listen]');if(listen)listen.addEventListener('click',startRecognition);
  const correct=document.querySelector('[data-correct]');if(correct)correct.addEventListener('click',()=>resolveBeat(true));
  const wrong=document.querySelector('[data-wrong]');if(wrong)wrong.addEventListener('click',()=>resolveBeat(false));
  const restart=document.querySelector('[data-restart]');if(restart)restart.addEventListener('click',()=>location.reload());
}
function screen(){
  if(state.phase==='idle')return `<section class="panel intro"><h2>看到假名，立刻唸出來</h2><p>本局 20 題，只練習 あ・い・う・え・お。</p><button class="primary" data-start ${state.mic==='requesting'?'disabled':''}>${state.mic==='requesting'?'啟用麥克風中…':'開始'}</button><small>${status()}</small></section>`;
  if(state.phase==='countdown')return `<section class="panel countdown"><span>${state.countdown||'START'}</span></section>`;
  if(state.phase==='playing'){
    const [kana]=state.round[state.index];
    const listenButton=Recognition&&state.mic!=='listening'?`<button class="primary listen-button" data-listen>${state.mic==='error'?'重新開始收音':'🎤 開始收音'}</button>`:'';
    return `<section class="game-layout"><div class="stats"><span>Score <b>${state.score}</b></span><span>Combo <b>${state.combo}</b></span><span>${state.index+1} / ${TOTAL}</span></div><div class="beat-card ${state.feedback.toLowerCase()}"><div class="pulse"></div><strong>${kana}</strong><p>${state.feedback||'唸出這個音'}</p>${state.heard?`<small>聽到：${state.heard}</small>`:''}</div><p class="mic-status">🎤 ${status()}</p>${listenButton}<div class="fallback-actions"><button data-correct>手動：正確</button><button data-wrong>手動：錯誤</button></div></section>`;
  }
  return `<section class="panel result"><p class="eyebrow">Result</p><h2>${state.correct} / ${TOTAL}</h2><dl><div><dt>分數</dt><dd>${state.score}</dd></div><div><dt>命中率</dt><dd>${Math.round(state.correct/TOTAL*100)}%</dd></div><div><dt>最高 Combo</dt><dd>${state.best}</dd></div></dl><button class="primary" data-restart>再玩一次</button></section>`;
}
async function startGame(){
  state.mic=Recognition?'requesting':'unsupported';render();
  if(Recognition&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());state.mic='ready'}catch(e){state.mic='error';state.lastError='麥克風權限'}}
  state.round=Array.from({length:TOTAL},()=>KANA[Math.floor(Math.random()*KANA.length)]);state.phase='countdown';state.countdown=3;render();
  const id=setInterval(()=>{state.countdown--;render();if(state.countdown===0){clearInterval(id);setTimeout(()=>{state.phase='playing';beginBeat()},250)}},700);
}
function beginBeat(){
  state.answered=false;state.feedback='';state.heard='';state.lastError='';clearTimeout(state.timer);stopRecognition();
  if(!Recognition)state.mic='unsupported';else if(isIOS)state.mic='waiting';else{state.mic='ready';setTimeout(startRecognition,0)}
  render();
}
function startRecognition(){
  if(!Recognition||state.answered)return;
  stopRecognition();clearTimeout(state.timer);state.mic='listening';state.lastError='';render();
  const r=new Recognition();r.lang='ja-JP';r.interimResults=false;r.maxAlternatives=5;r.continuous=false;
  r.onresult=e=>{const alternatives=Array.from(e.results[0]).map(x=>x.transcript);state.heard=alternatives[0]||'';const accepted=state.round[state.index][1];resolveBeat(alternatives.some(v=>accepted.includes(normalise(v))))};
  r.onerror=e=>{if(e.error!=='aborted'&&!state.answered){state.mic='error';state.lastError=e.error||'unknown';clearTimeout(state.timer);render()}};
  r.onend=()=>{if(!state.answered&&state.mic==='listening'){state.mic='waiting';clearTimeout(state.timer);render()}};
  state.recognition=r;
  try{r.start();state.timer=setTimeout(()=>{if(!state.answered)resolveBeat(false)},BEAT_MS*3)}catch(e){state.mic='error';state.lastError='啟動失敗';render()}
}
function resolveBeat(ok){
  if(state.answered)return;state.answered=true;stopRecognition();clearTimeout(state.timer);state.mic=Recognition?'ready':'unsupported';
  if(ok){state.correct++;state.combo++;state.best=Math.max(state.best,state.combo);state.score+=100+Math.min(state.combo*10,200);state.feedback='Correct'}else{state.combo=0;state.feedback='Wrong'}render();
  setTimeout(()=>{if(++state.index>=TOTAL){state.phase='finished';render()}else beginBeat()},450);
}
render();