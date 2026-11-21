// MyFriends — painel "Amigos": sessões de agentes de outras IDEs (Claude Code, Codex, Antigravity…)
// na mesma máquina, conversa da sala do projeto, fila de tarefas e instalação da skill nas outras IDEs.
// Usa window.LG (api, toast, esc) exposto por app.js; o CSS é injetado aqui mesmo.
(function () {
  'use strict';
  const LG = window.LG || {};
  const api = LG.api || (async (p, o = {}) => { const r = await fetch(p, { method: o.method || 'GET', headers: { 'content-type': 'application/json', 'x-lastgravity': '1' }, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  const toast = LG.toast || ((m) => console.log(m));
  const esc = LG.esc || ((s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  const TOOL = {
    lastgravity: { ab: 'LG', label: 'LastGravity', color: 'var(--accent)' },
    claude: { ab: 'CC', label: 'Claude Code', color: '#d97757' },
    codex: { ab: 'CX', label: 'Codex', color: 'var(--ok)' },
    antigravity: { ab: 'AG', label: 'Antigravity', color: '#60a5fa' },
    outro: { ab: '?', label: 'Outro', color: 'var(--muted)' },
  };
  const TYPE_LABEL = { chat: 'mensagem', context: 'contexto', task: 'tarefa', claim: 'pegou', done: 'concluiu', handoff: 'passou o trabalho' };
  const STATUS = { working: 'trabalhando', waiting: 'aguardando aprovação', idle: 'parado', online: 'online' };

  const css = document.createElement('style');
  css.textContent = `
#fr-btn{position:relative;display:inline-flex;align-items:center;gap:6px}
#fr-btn.fr-ping{animation:fr-ping 1.2s ease-out 2}@keyframes fr-ping{0%{box-shadow:0 0 0 0 var(--accent2)}100%{box-shadow:0 0 0 10px transparent}}
#fr-btn .fr-count{background:var(--accent2);color:#fff;border-radius:9px;padding:0 6px;font-size:11px;font-weight:700}
#fr-btn .fr-count.hidden,#fr-drawer .hidden{display:none}
#fr-drawer{position:fixed;top:0;right:0;bottom:0;width:min(420px,100vw);z-index:950;background:var(--panel);border-left:1px solid var(--line);box-shadow:-12px 0 32px #0009;display:flex;flex-direction:column;transform:translateX(105%);transition:transform .18s ease;color:var(--text);font-size:13px}
#fr-drawer.open{transform:none}
#fr-drawer .fr-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--panel2)}
#fr-drawer .fr-head b{flex:1}
#fr-drawer .fr-head select{width:auto;max-width:170px;padding:3px 6px;font-size:12px}
#fr-drawer .fr-body{flex:1;overflow:auto;display:flex;flex-direction:column}
#fr-drawer .fr-sec{border-bottom:1px solid var(--line)}
#fr-drawer .fr-sec>h4{margin:0;padding:8px 12px;font-size:11px;letter-spacing:.06em;color:var(--muted);font-weight:600;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none}
#fr-drawer .fr-sec>h4 .fr-n{color:var(--text);font-weight:600}
#fr-drawer .fr-sec.collapsed>.fr-in{display:none}
#fr-drawer .fr-in{padding:0 12px 10px}
.fr-ic{display:inline-grid;place-items:center;min-width:24px;height:20px;border-radius:5px;font:700 10px/1 system-ui;color:#000;padding:0 3px;flex:none}
.fr-sess{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px solid #ffffff08}
.fr-sess:first-child{border-top:none}
.fr-sess .fr-main{flex:1;min-width:0}
.fr-sess .fr-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fr-sess .fr-sub{color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fr-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:var(--ok)}
.fr-dot.waiting{background:var(--warn)}.fr-dot.idle{background:var(--muted)}
.fr-tag{font-size:10px;border:1px solid var(--line);border-radius:8px;padding:0 6px;color:var(--muted);margin-left:4px;white-space:nowrap}
.fr-msgs{display:flex;flex-direction:column;gap:6px;max-height:42vh;min-height:80px;overflow:auto;padding:4px 0}
.fr-msg{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
.fr-msg.mine{border-color:#3b2f5c;background:#1d1830}
.fr-msg.t-task,.fr-msg.t-handoff{border-left:3px solid var(--accent)}
.fr-msg.t-context{border-left:3px solid var(--accent2)}
.fr-msg.t-done{border-left:3px solid var(--ok)}
.fr-msg.t-claim{border-left:3px solid var(--warn)}
.fr-msg .fr-meta{display:flex;gap:6px;align-items:center;font-size:11px;color:var(--muted);margin-bottom:3px;flex-wrap:wrap}
.fr-msg .fr-meta b{color:var(--text);font-weight:600}
.fr-msg .fr-text{white-space:pre-wrap;word-break:break-word}
.fr-msg .fr-files{font-size:11px;color:var(--muted);margin-top:3px;font-family:ui-monospace,monospace;word-break:break-all}
.fr-msg pre{margin:4px 0 0;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:6px;font-size:11px;max-height:160px;overflow:auto;white-space:pre}
.fr-compose{display:grid;gap:6px;margin-top:8px}
.fr-compose textarea{resize:vertical;min-height:54px}
.fr-row{display:flex;gap:6px;align-items:center}
.fr-row select{flex:1;min-width:0;padding:4px 6px;font-size:12px}
.fr-task{display:flex;gap:8px;padding:6px 0;border-top:1px solid #ffffff08;align-items:flex-start}
.fr-task:first-child{border-top:none}
.fr-task .fr-st{font-size:14px;line-height:1.2;width:16px;text-align:center}
.fr-task .fr-res{color:var(--muted);font-size:11px;margin-top:2px}
.fr-empty{color:var(--muted);font-size:12px;padding:6px 0}
.fr-ide{display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid #ffffff08}
.fr-ide:first-child{border-top:none}
.fr-ide .fr-main{flex:1;min-width:0}
.fr-ide .fr-sub{color:var(--muted);font-size:11px;word-break:break-all}
.fr-ok{color:var(--ok)}.fr-warn{color:var(--warn)}.fr-err{color:var(--err)}
.fr-note{color:var(--muted);font-size:11px;line-height:1.45;margin:6px 0 0}
#fr-modal{position:fixed;inset:0;z-index:960;background:#0009;display:grid;place-items:center}
#fr-modal.hidden{display:none}
#fr-modal .fr-box{background:var(--panel);border:1px solid var(--line);border-radius:12px;width:min(560px,94vw);max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px #000a}
#fr-modal .fr-box>header{padding:14px 16px 6px;font-weight:700}
#fr-modal .fr-box>.fr-mbody{padding:6px 16px;overflow:auto;display:grid;gap:10px}
#fr-modal .fr-box>footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--line)}
#fr-modal label{display:grid;gap:4px;color:var(--muted);font-size:12px}
#fr-modal pre{margin:0;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px;font-size:11px;max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-all}
`;
  document.head.appendChild(css);

  const F = { open: false, data: null, targets: null, room: '', lastRead: Number(localStorage.getItem('lg.friends.lastRead') || 0), collapsed: JSON.parse(localStorage.getItem('lg.friends.collapsed') || '{}'), loading: false, timer: null };

  // ---------------------------------------------------------------- botão + gaveta
  const btn = document.createElement('button');
  btn.id = 'fr-btn';
  btn.type = 'button';
  btn.title = 'MyFriends: converse e divida o trabalho com agentes de outras IDEs (Claude Code, Codex, Antigravity)';
  btn.innerHTML = '<span aria-hidden="true">👥</span> Amigos <span class="fr-count hidden"></span>';
  const actions = document.querySelector('.topbar .actions');
  const settingsBtn = document.getElementById('btn-settings');
  if (actions && settingsBtn && settingsBtn.parentElement === actions) actions.insertBefore(btn, settingsBtn);
  else if (actions) actions.appendChild(btn);
  else { const sb = document.getElementById('statusbar'); (sb || document.body).appendChild(btn); }

  const drawer = document.createElement('aside');
  drawer.id = 'fr-drawer';
  drawer.setAttribute('aria-label', 'Amigos (MyFriends)');
  drawer.innerHTML = `
    <div class="fr-head"><b>👥 Amigos <span class="muted">· MyFriends</span></b>
      <select id="fr-room" title="Sala"></select>
      <button type="button" class="small" id="fr-reload" title="Atualizar">⟳</button>
      <button type="button" class="small" id="fr-close" title="Fechar">✕</button></div>
    <div class="fr-body">
      <section class="fr-sec" data-sec="online"><h4>ONLINE <span class="fr-n" id="fr-n-online"></span></h4><div class="fr-in" id="fr-online"></div></section>
      <section class="fr-sec" data-sec="chat"><h4>CONVERSA DA SALA <span class="fr-n" id="fr-n-chat"></span></h4><div class="fr-in">
        <div class="fr-msgs" id="fr-msgs"></div>
        <form class="fr-compose" id="fr-form">
          <textarea id="fr-text" placeholder="Escreva para as outras sessões… (Ctrl+Enter envia)"></textarea>
          <div class="fr-row">
            <select id="fr-type" title="Tipo"><option value="chat">Mensagem</option><option value="context">Contexto</option><option value="task">Tarefa</option><option value="handoff">Passar o trabalho</option></select>
            <select id="fr-to" title="Para"></select>
            <button type="submit" class="primary small">Enviar</button>
          </div>
        </form></div></section>
      <section class="fr-sec" data-sec="tasks"><h4>TAREFAS COMPARTILHADAS <span class="fr-n" id="fr-n-tasks"></span></h4><div class="fr-in">
        <div id="fr-tasks"></div>
        <div class="fr-row" style="margin-top:6px"><button type="button" class="small" id="fr-ask">Pedir a um amigo…</button></div></div></section>
      <section class="fr-sec" data-sec="install"><h4>INSTALAR MYFRIENDS EM OUTRAS IDES</h4><div class="fr-in">
        <div id="fr-ides"></div>
        <p class="fr-note">A skill ensina o agente de cada IDE a entrar na sala do projeto, ler mensagens entre as etapas, reservar arquivos antes de editar e compartilhar um resumo ao terminar. No Claude Code e no Codex, a instalação também liga avisos automáticos: as mensagens aparecem na IDE e como notificação do sistema, e chegam ao agente no próximo passo (o Claude Code é acordado quando chega um pedido para ele). No Codex, rode /hooks uma vez para confiar nos ganchos. No Antigravity, o agente lê as mensagens quando roda um comando.</p></div></section>
    </div>`;
  document.body.appendChild(drawer);

  const modal = document.createElement('div');
  modal.id = 'fr-modal';
  modal.className = 'hidden';
  document.body.appendChild(modal);

  const $ = (s) => drawer.querySelector(s);
  for (const sec of drawer.querySelectorAll('.fr-sec')) {
    if (F.collapsed[sec.dataset.sec]) sec.classList.add('collapsed');
    sec.querySelector('h4').onclick = () => {
      sec.classList.toggle('collapsed');
      F.collapsed[sec.dataset.sec] = sec.classList.contains('collapsed');
      localStorage.setItem('lg.friends.collapsed', JSON.stringify(F.collapsed));
    };
  }

  function setOpen(v) {
    F.open = v;
    drawer.classList.toggle('open', v);
    if (v) { load(); loadTargets(); clearInterval(F.timer); F.timer = setInterval(load, 15000); setTimeout(() => $('#fr-text').focus(), 200); }
    else clearInterval(F.timer);
  }
  btn.onclick = () => setOpen(!F.open);
  $('#fr-close').onclick = () => setOpen(false);
  $('#fr-reload').onclick = () => { load(); loadTargets(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && F.open && modal.classList.contains('hidden')) setOpen(false); });
  $('#fr-room').onchange = (e) => { F.room = e.target.value; load(); };

  // ---------------------------------------------------------------- dados
  const ago = (ts) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? 'agora' : s < 3600 ? `há ${Math.round(s / 60)} min` : `há ${Math.round(s / 3600)} h`; };
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const icon = (tool) => { const t = TOOL[tool] || TOOL.outro; return `<span class="fr-ic" style="background:${t.color}" title="${esc(t.label)}">${t.ab}</span>`; };

  async function load() {
    if (F.loading) return;
    F.loading = true;
    try {
      F.data = await api(`/api/friends${F.room ? `?room=${encodeURIComponent(F.room)}` : ''}`);
      render();
    } catch (e) {
      if (F.open) $('#fr-online').innerHTML = `<div class="fr-empty fr-err">${esc(e.message)}</div>`;
    } finally { F.loading = false; }
  }

  function updateBadge() {
    const d = F.data;
    if (!d?.available) return;
    const mine = new Set([d.me.id, ...Object.values(d.agents || {})]);
    const unread = (d.messages || []).filter((m) => !mine.has(m.from) && m.ts > F.lastRead).length;
    const el = btn.querySelector('.fr-count');
    const online = (d.sessions || []).filter((s) => s.id !== d.me.id && !Object.values(d.agents || {}).includes(s.id)).length;
    el.textContent = unread ? String(unread) : '';
    el.classList.toggle('hidden', !unread);
    btn.title = `MyFriends: ${online} sessão(ões) de outras IDEs online${unread ? ` · ${unread} mensagem(ns) nova(s)` : ''}`;
  }

  function render() {
    const d = F.data;
    if (!d) return;
    if (!d.available) { $('#fr-online').innerHTML = `<div class="fr-empty fr-err">MyFriends indisponível: ${esc(d.error || '')}</div>`; return; }
    if (F.open) { F.lastRead = Math.max(F.lastRead, ...(d.messages || []).map((m) => m.ts), 0); localStorage.setItem('lg.friends.lastRead', String(F.lastRead)); }
    updateBadge();
    if (!F.open) return;

    // salas
    const rooms = [...new Set([d.projectRoom, ...(d.rooms || []), d.room])];
    $('#fr-room').innerHTML = rooms.map((r) => `<option value="${esc(r)}" ${r === d.room ? 'selected' : ''}>${r === d.projectRoom ? `${esc(r)} (projeto)` : esc(r)}</option>`).join('');

    // sessões
    const mine = new Set(Object.values(d.agents || {}));
    const sess = (d.sessions || []).slice().sort((a, b) => (b.room === d.room) - (a.room === d.room) || (a.kind === 'human') - (b.kind === 'human'));
    $('#fr-n-online').textContent = sess.length ? String(sess.length) : '';
    $('#fr-online').innerHTML = sess.length ? sess.map((s) => `<div class="fr-sess">
        <span class="fr-dot ${s.status === 'waiting' ? 'waiting' : s.status === 'idle' ? 'idle' : ''}" title="${esc(STATUS[s.status] || s.status || '')}"></span>${icon(s.tool)}
        <div class="fr-main"><div class="fr-name">${esc(s.name)}${s.id === d.me.id ? '<span class="fr-tag">você</span>' : mine.has(s.id) ? '<span class="fr-tag">agente daqui</span>' : ''}${s.room !== d.room ? `<span class="fr-tag">${s.folder === d.me.folder ? 'outra sala' : esc(s.project)}</span>` : ''}</div>
        <div class="fr-sub">${s.doing ? `${esc(s.doing)} · ` : ''}${esc(STATUS[s.status] || 'online')} · ${ago(s.lastSeen)}</div></div></div>`).join('')
      : '<div class="fr-empty">Ninguém online ainda. Instale o MyFriends nas outras IDEs (abaixo) e peça ao agente de lá: “entra no MyFriends”.</div>';

    // destinatários
    const toSel = $('#fr-to');
    const prevTo = toSel.value;
    const others = (d.sessions || []).filter((s) => s.id !== d.me.id);
    toSel.innerHTML = `<option value="">Sala inteira</option>${others.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}`;
    if (others.some((s) => s.id === prevTo)) toSel.value = prevTo;

    // mensagens
    const box = $('#fr-msgs');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const msgs = d.messages || [];
    $('#fr-n-chat').textContent = msgs.length ? String(msgs.length) : '';
    box.innerHTML = msgs.length ? msgs.map((m) => `<div class="fr-msg t-${esc(m.type)} ${m.from === d.me.id ? 'mine' : ''}">
        <div class="fr-meta">${icon(m.tool)}<b>${esc(m.fromName)}</b>${m.toName ? `→ <b>${esc(m.to === d.me.id ? 'você' : m.toName)}</b>` : ''}<span>· ${esc(TYPE_LABEL[m.type] || m.type)}</span><span>· ${hhmm(m.ts)}</span>${m.ref ? `<span title="${esc(m.ref)}">· ref ${esc(m.ref.slice(-6))}</span>` : ''}</div>
        <div class="fr-text">${esc(m.text)}</div>
        ${m.files?.length ? `<div class="fr-files">📎 ${m.files.map(esc).join(', ')}</div>` : ''}
        ${(m.snippets || []).map((s) => `<div class="fr-files">${esc(s.path)}${s.lines ? `:${esc(s.lines)}` : ''}</div><pre>${esc(s.text)}</pre>`).join('')}
        ${m.redacted ? `<div class="fr-files fr-warn">${m.redacted} segredo(s) removido(s) automaticamente</div>` : ''}</div>`).join('')
      : '<div class="fr-empty">Sem mensagens nesta sala.</div>';
    if (atBottom || !F.rendered) box.scrollTop = box.scrollHeight;
    F.rendered = true;

    // tarefas
    const b = d.board || { tasks: [], claims: [] };
    const open = b.tasks.filter((t) => t.status !== 'done').length;
    $('#fr-n-tasks').textContent = b.tasks.length ? `${open} aberta(s) / ${b.tasks.length}` : '';
    const st = { open: ['○', 'aberta'], claimed: ['◐', 'em andamento'], done: ['✔', 'concluída'] };
    $('#fr-tasks').innerHTML = (b.tasks.length ? b.tasks.slice().reverse().map((t) => `<div class="fr-task"><span class="fr-st ${t.status === 'done' ? 'fr-ok' : t.status === 'claimed' ? 'fr-warn' : ''}" title="${st[t.status][1]}">${st[t.status][0]}</span>
        <div class="fr-main"><div>${esc(t.text.split('\n')[0].slice(0, 200))}</div>
        <div class="fr-res">${esc(st[t.status][1])}${t.byName ? ` · ${esc(t.byName)}` : ''} · de ${esc(t.fromName)}${t.toName ? ` para ${esc(t.toName)}` : ''}${t.type === 'handoff' ? ' · handoff' : ''}${t.status === 'open' && t.acceptance === 'enviado' ? ' · aguardando alguém assumir' : ''}${t.takeoverFromName ? ` · assumida no lugar de ${esc(t.takeoverFromName)}` : ''}${(t.abandonedBy || t.abandonedById) ? ` · abandonada por ${esc(t.abandonedBy || t.abandonedById)}` : ''}</div>
        ${t.result ? `<div class="fr-res fr-ok">↳ ${esc(t.result.slice(0, 300))}</div>` : ''}</div></div>`).join('') : '<div class="fr-empty">Nenhuma tarefa na fila.</div>')
      + (b.claims.length ? `<div class="fr-note"><b>Arquivos reservados:</b><br>${b.claims.map((c) => `${esc(c.byName)}: <code>${c.files.map(esc).join(', ')}</code>`).join('<br>')}</div>` : '');
  }

  // ---------------------------------------------------------------- enviar
  async function send(body) {
    await api('/api/friends/send', { method: 'POST', body: { room: F.data?.room, ...body } });
    await load();
  }
  $('#fr-form').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#fr-text').value.trim();
    if (!text) return;
    try {
      await send({ text, type: $('#fr-type').value, to: $('#fr-to').value || undefined });
      $('#fr-text').value = '';
      $('#fr-type').value = 'chat';
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#fr-text').onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#fr-form').requestSubmit(); } };

  // ---------------------------------------------------------------- modal genérico
  function openModal(title, bodyHtml, buttons) {
    modal.innerHTML = `<div class="fr-box" role="dialog" aria-modal="true"><header>${esc(title)}</header><div class="fr-mbody">${bodyHtml}</div><footer></footer></div>`;
    const foot = modal.querySelector('footer');
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.label;
      if (b.primary) el.className = 'primary';
      el.onclick = async () => { if (b.onclick) { el.disabled = true; try { if ((await b.onclick()) === false) { el.disabled = false; return; } } catch (e) { toast(e.message, 'error'); el.disabled = false; return; } } closeModal(); };
      foot.appendChild(el);
    }
    modal.classList.remove('hidden');
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
    modal.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeModal(); } };
    setTimeout(() => modal.querySelector('textarea,select,button')?.focus(), 50);
  }
  function closeModal() { modal.classList.add('hidden'); modal.innerHTML = ''; }

  // "Pedir a um amigo…": cria uma tarefa para uma sessão escolhida.
  $('#fr-ask').onclick = () => {
    const d = F.data;
    if (!d?.available) return;
    const others = (d.sessions || []).filter((s) => s.id !== d.me.id && s.kind !== 'human');
    openModal('Pedir a um amigo', `
      <label>Para quem?<select id="fr-ask-to"><option value="">Qualquer um da sala (fila)</option>${others.map((s) => `<option value="${esc(s.id)}">${esc((TOOL[s.tool] || TOOL.outro).label)} — ${esc(s.name)}${s.doing ? ` (${esc(s.doing.slice(0, 40))})` : ''}</option>`).join('')}</select></label>
      <label>O que precisa ser feito?<textarea id="fr-ask-text" rows="5" placeholder="Ex.: Revise src/auth.js e aponte problemas de segurança. Não altere outros arquivos."></textarea></label>
      <label><span><input type="checkbox" id="fr-ask-handoff" style="width:auto"> É um handoff (passar o restante do trabalho)</span></label>
      <p class="fr-note">A tarefa vai para a fila compartilhada. Sessões de outras IDEs a veem quando o agente delas checar as mensagens; elas tratam o pedido como informação e seguem as próprias regras de aprovação.</p>`, [
      { label: 'Cancelar' },
      { label: 'Criar tarefa', primary: true, onclick: async () => {
        const text = modal.querySelector('#fr-ask-text').value.trim();
        if (!text) { toast('Descreva a tarefa.', 'error'); return false; }
        await send({ text, type: modal.querySelector('#fr-ask-handoff').checked ? 'handoff' : 'task', to: modal.querySelector('#fr-ask-to').value || undefined });
        toast('Tarefa criada na sala.', 'ok');
      } },
    ]);
  };

  // ---------------------------------------------------------------- instalar nas outras IDEs
  async function loadTargets() {
    try { F.targets = await api('/api/friends/targets'); renderTargets(); }
    catch (e) { $('#fr-ides').innerHTML = `<div class="fr-empty fr-err">${esc(e.message)}</div>`; }
  }
  function renderTargets() {
    const t = F.targets;
    if (!t?.available) { $('#fr-ides').innerHTML = '<div class="fr-empty">Indisponível.</div>'; return; }
    $('#fr-ides').innerHTML = t.targets.map((x) => {
      const state = x.builtin ? '<span class="fr-ok">instalada (padrão)</span>'
        : !x.detected ? '<span class="muted">não encontrada nesta máquina</span>'
        : x.installed ? (x.upToDate ? `<span class="fr-ok">instalada ${esc(x.version)}</span>` : `<span class="fr-warn">desatualizada (${esc(x.version)} → ${esc(x.latest)})</span>`)
        : '<span class="fr-warn">não instalada</span>';
      const can = !x.builtin && x.detected;
      return `<div class="fr-ide">${icon(x.id)}<div class="fr-main"><div><b>${esc(x.label)}</b> · ${state}</div><div class="fr-sub">${esc(x.dir)}</div></div>
        ${can ? `<button type="button" class="small ${x.installed && x.upToDate ? '' : 'primary'}" data-install="${esc(x.id)}">${x.installed ? (x.upToDate ? 'Reinstalar' : 'Atualizar') : 'Instalar'}</button>` : ''}</div>`;
    }).join('');
    for (const b of $('#fr-ides').querySelectorAll('[data-install]')) b.onclick = () => confirmInstall([b.dataset.install]);
  }
  async function confirmInstall(ids) {
    let res;
    try { res = await api('/api/friends/install', { method: 'POST', body: { targets: ids } }); }
    catch (e) { return toast(e.message, 'error'); }
    const lines = res.plan.map((p) => `${p.label} → ${p.dir}${p.replaces ? '  (substitui a versão instalada)' : ''}\n${p.files.map((f) => `   ${f.path}  (${f.bytes} bytes)`).join('\n')}${p.hooksFile ? `\n   + avisos automáticos de mensagens (hooks) em ${p.hooksFile}` : ''}`).join('\n\n');
    openModal('Instalar MyFriends', `<p class="fr-note" style="margin:0">Estes arquivos serão gravados no seu computador. Nada sai da sua máquina.</p><pre>${esc(lines)}</pre>
      <p class="fr-note" style="margin:0">Depois, abra uma sessão nova do agente nessa IDE (ou reinicie-a) para a skill aparecer.</p>`, [
      { label: 'Cancelar' },
      { label: 'Instalar', primary: true, onclick: async () => {
        const r = await api('/api/friends/install', { method: 'POST', body: { targets: ids, confirm: true } });
        toast(`MyFriends instalado: ${r.installed.map((x) => x.label).join(', ')}.`, 'ok');
        F.targets = { ...F.targets, targets: r.targets };
        renderTargets();
      } },
    ]);
  }

  // ---------------------------------------------------------------- tempo real
  let soon = null;
  window.addEventListener('lg:friends', (e) => {
    clearTimeout(soon); soon = setTimeout(load, 200);
    // Mensagem nova de outra IDE: aviso na tela (o app desktop também mostra a notificação do sistema).
    const list = (e.detail?.incoming || []).filter((m) => m.forUser || m.type === 'task' || m.type === 'handoff');
    if (!list.length) return;
    const m = list[list.length - 1];
    const kind = m.type === 'task' ? ' (tarefa)' : m.type === 'handoff' ? ' (handoff)' : '';
    const txt = String(m.text || '').replace(/\s+/g, ' ');
    window.LG?.toast?.(`📨 ${m.fromName}${kind}: ${txt.length > 140 ? `${txt.slice(0, 140)}…` : txt}${list.length > 1 ? ` (+${list.length - 1})` : ''}${F.open ? '' : ' — veja em 👥 Amigos'}`, 'info', 7000);
    if (!F.open) { btn.classList.remove('fr-ping'); void btn.offsetWidth; btn.classList.add('fr-ping'); }
  });
  load();

  window.LGFriends = { open: () => setOpen(true), close: () => setOpen(false), reload: load };
})();
