// Buddy — mascote em pixel art que reage ao que os agentes estão fazendo.
// /buddy nome <novo nome> · /buddy trocar · /buddy mudo · /buddy som
(() => {
  const CHARS = {
    grav: { name: 'Grav', body: ['#ffb37a', '#ff7a45', '#c2410c'], ring: '#e9d5ff' },
    luna: { name: 'Luna', body: ['#e2e8f0', '#94a3b8', '#475569'], ring: '#a5f3fc' },
    sol: { name: 'Sol', body: ['#fef08a', '#facc15', '#ca8a04'], ring: '#fdba74' },
    nebula: { name: 'Nébula', body: ['#c4b5fd', '#8b5cf6', '#5b21b6'], ring: '#f9a8d4' },
  };
  const SAY = {
    idle: ['Pronto quando você estiver.', 'Bora codar?', 'Gravidade zero por aqui.'],
    working: ['Trabalhando nisso…', 'Orbitando o código…', 'Lendo arquivos…', 'Quase lá…'],
    waiting: ['Preciso da sua aprovação!', 'Ei, dá uma olhada aqui?', 'Posso continuar?'],
    done: ['Pronto! ✨', 'Missão cumprida!', 'Terminei, confere aí?'],
    error: ['Ops, deu erro.', 'Algo saiu da órbita…', 'Preciso de ajuda aqui.'],
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`lg.buddy.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`lg.buddy.${k}`, JSON.stringify(v)); } catch {} },
  };
  const B = { char: store.get('char', 'grav'), name: store.get('name', ''), muted: store.get('muted', false), sound: store.get('sound', false), state: 'idle', frame: 0, statuses: new Map(), bubbleT: 0 };
  if (!CHARS[B.char]) B.char = 'grav';

  const wrap = document.createElement('div');
  wrap.id = 'buddy';
  wrap.innerHTML = '<div class="bubble hidden"></div><canvas width="16" height="16" title="Clique para uma dica"></canvas><div class="bname"></div>';
  const style = document.createElement('style');
  style.textContent = `#buddy{position:fixed;left:14px;bottom:14px;z-index:900;display:flex;flex-direction:column;align-items:flex-start;pointer-events:none}
#buddy canvas{width:48px;height:48px;image-rendering:pixelated;cursor:pointer;pointer-events:auto;filter:drop-shadow(0 4px 8px #0008)}
#buddy .bname{font:600 10px system-ui;color:var(--muted);margin-left:4px}
#buddy .bubble{pointer-events:auto;max-width:220px;background:var(--panel2);border:1px solid var(--line);color:var(--text);font:12px system-ui;padding:6px 10px;border-radius:10px 10px 10px 2px;margin-bottom:6px;box-shadow:0 6px 18px #0008;animation:bin .2s ease}
#buddy .bubble.hidden{display:none}#buddy.hide{display:none}
#buddy.docked{position:relative;left:auto;bottom:auto;flex-direction:row;align-items:center;gap:6px}
#buddy.docked canvas{width:20px;height:20px;filter:none}
#buddy.docked .bname{margin:0;font-size:11px}
#buddy.docked{flex-direction:row-reverse}
#buddy.docked .bubble{position:static;margin:0;padding:1px 8px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis;border-radius:8px;font-size:11px;box-shadow:none;background:var(--sel);border-color:var(--line)}
@keyframes bin{from{opacity:0;transform:translateY(4px)}}`;
  document.head.appendChild(style);
  // Fica na barra de status (rodapé), sem cobrir nada; sem barra, fica no canto.
  const slot = document.getElementById('buddy-slot');
  if (slot) { wrap.classList.add('docked'); slot.appendChild(wrap); } else document.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas'), ctx = cv.getContext('2d'), bubble = wrap.querySelector('.bubble');

  function px(x, y, c) { if (x >= 0 && x < 16 && y >= 0 && y < 16) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); } }
  function draw() {
    const ch = CHARS[B.char];
    const dy = B.state === 'working' ? (B.frame % 12 < 6 ? 0 : -1) : B.state === 'done' ? (B.frame % 8 < 4 ? -1 : 0) : 0;
    ctx.clearRect(0, 0, 16, 16);
    const cx = 7.5, cy = 8.5 + dy;
    const ringY = (x) => cy + 1 + (x - cx) * -0.28;
    // anel de trás
    for (let x = 0; x < 16; x++) { const y = Math.round(ringY(x)) - 1; if (Math.hypot(x - cx, y - cy) > 5.2) px(x, y, ch.ring); }
    // corpo com sombreado
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < 5.6) px(x, y, (x - cx) + (y - cy) < -3 ? ch.body[0] : (x - cx) + (y - cy) > 3 ? ch.body[2] : ch.body[1]);
    }
    // anel da frente
    for (let x = 0; x < 16; x++) { const y = Math.round(ringY(x)); if (y > cy - 0.5 || Math.hypot(x - cx, y - cy) > 5.2) px(x, y, ch.ring); }
    // olhos
    const ey = Math.round(cy - 1), blink = B.frame % 50 === 0 || B.frame % 50 === 1;
    const eye = B.state === 'error' ? '#1e1b4b' : '#111827';
    if (blink || B.state === 'done') { px(5, ey, eye); px(6, ey, eye); px(9, ey, eye); px(10, ey, eye); }
    else { px(5, ey, eye); px(5, ey - 1, eye); px(10, ey, eye); px(10, ey - 1, eye); px(5, ey - 1, '#ffffff'); px(10, ey - 1, '#ffffff'); px(5, ey, eye); px(10, ey, eye); }
    // boca
    const my = Math.round(cy + 2), m = '#111827';
    if (B.state === 'done') { px(6, my, m); px(7, my + 1, m); px(8, my + 1, m); px(9, my, m); }
    else if (B.state === 'error') { px(6, my + 1, m); px(7, my, m); px(8, my, m); px(9, my + 1, m); }
    else if (B.state === 'working') { px(7, my, m); px(8, my, m); px(7, my + 1, m); px(8, my + 1, m); }
    else if (B.state === 'waiting') { px(7, my, m); px(8, my, m); }
    else { px(6, my, m); px(7, my + 1, m); px(8, my + 1, m); px(9, my, m); }
    // extras
    if (B.state === 'waiting' && B.frame % 16 < 10) { px(14, 1, '#fbbf24'); px(14, 2, '#fbbf24'); px(14, 3, '#fbbf24'); px(14, 5, '#fbbf24'); }
    if (B.state === 'done') { const s = B.frame % 6 < 3; px(s ? 1 : 2, s ? 2 : 1, '#fde68a'); px(s ? 14 : 13, s ? 3 : 2, '#fde68a'); }
    if (B.state === 'working') { const n = (B.frame >> 3) % 4; for (let i = 0; i < n; i++) px(12 + i, 1, '#a78bfa'); }
  }
  function say(text, ms = 4000) {
    if (B.muted) return;
    bubble.textContent = text;
    bubble.classList.remove('hidden');
    clearTimeout(B.bubbleT);
    B.bubbleT = setTimeout(() => bubble.classList.add('hidden'), ms);
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function beep(freq) {
    if (!B.sound || B.muted) return;
    try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.04; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.08); setTimeout(() => a.close(), 200); } catch {}
  }
  function setState(s, speak = true) {
    if (s === B.state) return;
    B.state = s;
    if (speak) say(pick(SAY[s]));
    if (s === 'waiting') beep(880); else if (s === 'done') beep(660); else if (s === 'error') beep(220);
  }
  function refresh() {
    wrap.classList.toggle('hide', B.muted);
    wrap.querySelector('.bname').textContent = B.name || CHARS[B.char].name;
  }

  window.addEventListener('lg:agent', (e) => {
    const a = e.detail;
    const prev = B.statuses.get(a.id);
    B.statuses.set(a.id, a.status);
    const all = [...B.statuses.values()];
    if (all.includes('awaiting_approval')) return setState('waiting');
    if (all.includes('running')) return setState('working', prev !== 'running');
    if (prev && prev !== a.status && a.status === 'done') { setState('done'); clearTimeout(B.doneT); B.doneT = setTimeout(() => setState('idle', false), 6000); return; }
    if (prev && prev !== a.status && a.status === 'error') return setState('error');
    if (!all.some((s) => s === 'running' || s === 'awaiting_approval') && B.state !== 'done' && B.state !== 'error') setState('idle', false);
  });

  const TIPS = ['Digite / no chat para ver os comandos.', 'Cole uma imagem no chat com ⌘V para o agente ver.', 'Use /model ollama:qwen2.5-coder:14b para rodar grátis no seu Mac.', 'Use /fork para testar outro caminho sem perder a conversa.', 'O agente pode subir seu servidor com start_background e testar sozinho.', 'Em Configurações → Modelos dá para planejar com um modelo forte e explorar com um barato.'];
  cv.addEventListener('click', () => say(pick(TIPS), 6000));

  window.LGBuddy = {
    command(arg = '') {
      const [sub, ...rest] = arg.trim().split(/\s+/);
      const toast = window.LG?.toast || (() => {});
      if (!sub) { B.muted = false; store.set('muted', false); refresh(); say(`Oi! Eu sou ${B.name || CHARS[B.char].name}. Comandos: /buddy nome <nome>, trocar, mudo, som.`, 7000); return; }
      if (sub === 'nome') { B.name = rest.join(' ').slice(0, 24); store.set('name', B.name); refresh(); say(B.name ? `Agora eu sou ${B.name}!` : 'Voltei ao meu nome de sempre.'); return; }
      if (sub === 'trocar') { const ks = Object.keys(CHARS); B.char = ks[(ks.indexOf(B.char) + 1) % ks.length]; store.set('char', B.char); refresh(); say(`Visual: ${CHARS[B.char].name}.`); return; }
      if (sub === 'mudo') { B.muted = !B.muted; store.set('muted', B.muted); refresh(); toast(B.muted ? 'Mascote escondido. Use /buddy para trazer de volta.' : 'Mascote de volta.', 'info'); return; }
      if (sub === 'som') { B.sound = !B.sound; store.set('sound', B.sound); toast(B.sound ? 'Sons do mascote ligados.' : 'Sons do mascote desligados.', 'info'); beep(660); return; }
      toast('Use: /buddy, /buddy nome <nome>, /buddy trocar, /buddy mudo, /buddy som', 'info');
    },
  };

  refresh();
  setInterval(() => { B.frame++; draw(); }, 90);
  draw();
})();
