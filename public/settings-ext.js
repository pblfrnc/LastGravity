// Abas extras do diálogo de Configurações: Modelos, MCP e Skills.
// Usa o contrato window.LG exposto por app.js (registerSettingsTab, api, toast, esc).
(function () {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    const late = {};
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'value' || k === 'checked' || k === 'selected') late[k] = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    if ('value' in late) n.value = late.value;
    if ('checked' in late) n.checked = !!late.checked;
    return n;
  }
  const field = (label, control, hint) => el('label', { class: 'lgx-field' }, el('span', { class: 'lgx-label' }, label), control, hint ? el('small', { class: 'muted' }, hint) : null);
  const section = (title, desc, ...kids) => el('section', { class: 'lgx-section' }, el('h3', null, title), desc ? el('p', { class: 'muted lgx-desc' }, desc) : null, ...kids);
  const btn = (text, onclick, cls = 'small', extra = {}) => el('button', { type: 'button', class: cls, onclick, ...extra }, text);
  const uid = (() => { let n = 0; return (p) => `${p}-${++n}`; })();

  function copyText(text, toast) {
    const done = () => toast('Caminho copiado.', 'ok');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch { toast('Não foi possível copiar; selecione o texto manualmente.', 'error'); }
      ta.remove();
    }
  }

  function providerList(draft, ctx) {
    try { const l = ctx.providers?.(); if (Array.isArray(l) && l.length) return l; } catch {}
    return Object.entries(draft.providers || {}).map(([id, p]) => ({ id, ...p }));
  }
  const providerLabel = (draft, id) => draft.providers?.[id]?.label || id;

  const STYLE = `
.lgx-tab { display: flex; flex-direction: column; gap: 18px; }
.lgx-section { background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.lgx-section h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text); letter-spacing: .2px; }
.lgx-desc { margin: -4px 0 2px; font-size: 12px; line-height: 1.45; }
.lgx-tab .lgx-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.lgx-field > small { font-size: 11px; line-height: 1.4; }
.lgx-label { font-size: 12px; color: var(--muted); }
.lgx-inline { display: flex; gap: 8px; align-items: center; min-width: 0; }
.lgx-inline > input, .lgx-inline > select { flex: 1; min-width: 0; }
.lgx-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.lgx-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.lgx-spacer { flex: 1; }
.lgx-list { display: flex; flex-direction: column; gap: 8px; }
.lgx-item { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.lgx-item.lgx-open { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
.lgx-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; min-width: 0; }
.lgx-head > .lgx-grow { min-width: 160px; }
.lgx-sub[data-mcp-text] { white-space: normal; }
.lgx-title { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lgx-sub { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lgx-grow { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.lgx-badge { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.lgx-badge.accent { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
.lgx-badge.violet { color: var(--accent2); border-color: color-mix(in srgb, var(--accent2) 50%, transparent); }
.lgx-badge.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 50%, transparent); }
.lgx-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--muted); opacity: .6; }
.lgx-dot.ok { background: var(--ok); opacity: 1; box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); }
.lgx-dot.err { background: var(--err); opacity: 1; box-shadow: 0 0 0 3px color-mix(in srgb, var(--err) 22%, transparent); }
.lgx-dot.warn { background: var(--warn); opacity: 1; animation: lgx-pulse 1.2s infinite ease-in-out; }
@keyframes lgx-pulse { 50% { opacity: .35; } }
.lgx-tab .lgx-switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); cursor: pointer; white-space: nowrap; }
.lgx-switch input { accent-color: var(--accent); margin: 0; width: auto; }
.lgx-tab .lgx-check { display: flex; color: var(--text); gap: 8px; align-items: flex-start; font-size: 12.5px; cursor: pointer; }
.lgx-check input { accent-color: var(--accent); margin-top: 2px; width: auto; flex: none; }
.lgx-pre { margin: 0; max-height: 180px; overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: 11.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; color: var(--muted); }
.lgx-error { color: var(--err); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.lgx-ok { color: var(--ok); font-size: 12px; }
.lgx-tools { display: flex; flex-wrap: wrap; gap: 6px; }
.lgx-tool { font: 11.5px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 8px; border-radius: 6px; background: var(--bg); border: 1px solid var(--line); }
.lgx-mono, .lgx-tab textarea.lgx-mono { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.lgx-tab textarea { width: 100%; box-sizing: border-box; resize: vertical; }
.lgx-path { display: flex; align-items: center; gap: 8px; min-width: 0; }
.lgx-path code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--muted); background: var(--bg); border: 1px solid var(--line); border-radius: 5px; padding: 3px 7px; user-select: all; }
.lgx-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.lgx-chip { border: 1px dashed var(--line); background: transparent; color: var(--text); border-radius: 999px; padding: 4px 11px; font-size: 12px; cursor: pointer; }
.lgx-chip:hover { border-color: var(--accent); color: var(--accent); }
.lgx-empty { font-size: 12.5px; color: var(--muted); padding: 14px; text-align: center; border: 1px dashed var(--line); border-radius: 8px; }
.lgx-star { color: var(--accent); }
.lgx-danger { color: var(--err) !important; }
.lgx-tab details > summary { cursor: pointer; font-size: 12px; color: var(--muted); }
@media (max-width: 720px) { .lgx-grid3 { grid-template-columns: 1fr; } }
`;

  // ---------------------------------------------------------------- aba Modelos
  const modelCache = {}; // providerId -> [ids]
  const favForm = { providerId: '', model: '', label: '' };

  function modelPicker({ draft, ctx, getProvider, value, onInput, placeholder }) {
    const listId = uid('lgx-models');
    const dl = el('datalist', { id: listId });
    const fill = () => { dl.replaceChildren(...(modelCache[getProvider()] || []).map((m) => el('option', { value: m }))); };
    fill();
    const input = el('input', { type: 'text', list: listId, value: value || '', placeholder: placeholder || 'nome do modelo', spellcheck: 'false', oninput: (e) => onInput(e.target.value.trim()) });
    const b = btn('Buscar modelos', async () => {
      const id = getProvider();
      if (!id) return;
      b.disabled = true; b.textContent = 'Buscando…';
      try {
        const r = await ctx.api('/api/providers/models', { method: 'POST', body: { id, provider: draft.providers[id] } });
        if (r.ok) {
          modelCache[id] = r.models || [];
          fill();
          ctx.toast(`${modelCache[id].length} modelo(s) encontrado(s) em ${providerLabel(draft, id)}.`, 'ok');
          input.focus();
        } else ctx.toast(`Não foi possível listar modelos: ${r.error}`, 'error');
      } catch (e) { ctx.toast(`Erro ao buscar modelos: ${e.message}`, 'error'); }
      finally { b.disabled = false; b.textContent = 'Buscar modelos'; }
    });
    return el('div', { class: 'lgx-inline' }, input, dl, b);
  }

  function providerSelect(draft, ctx, value, onChange, { allowEmpty } = {}) {
    return el('select', { value: value || '', onchange: (e) => onChange(e.target.value) },
      allowEmpty ? el('option', { value: '' }, 'Mesmo provedor do agente') : null,
      providerList(draft, ctx).map((p) => el('option', { value: p.id }, p.label || p.id)));
  }

  function renderModels(container, draft, ctx) {
    draft.routing = draft.routing || {};
    draft.routing.explore = draft.routing.explore || { providerId: '', model: '' };
    draft.modelParams = { temperature: null, maxTokens: 16000, reasoningEffort: '', ...(draft.modelParams || {}) };
    draft.favoriteModels = Array.isArray(draft.favoriteModels) ? draft.favoriteModels : [];
    if (!draft.providers?.[draft.defaultProvider]) draft.defaultProvider = Object.keys(draft.providers || {})[0] || '';
    const dirty = () => ctx.markDirty();
    const cur = () => draft.providers[draft.defaultProvider] || {};

    // Padrão
    const defSection = section('Modelo padrão', 'Usado ao criar novos agentes. Cada agente ainda pode trocar de modelo depois.',
      el('div', { class: 'row' },
        field('Provedor', providerSelect(draft, ctx, draft.defaultProvider, (v) => { draft.defaultProvider = v; dirty(); ctx.rerender(); })),
        field('Modelo', modelPicker({ draft, ctx, getProvider: () => draft.defaultProvider, value: cur().model, onInput: (v) => { cur().model = v; dirty(); } }),
          'Digite o nome ou use "Buscar modelos" para ver os disponíveis na sua conta.')),
      el('div', { class: 'lgx-actions' }, btn('★ Adicionar aos favoritos', () => {
        const m = cur().model;
        if (!m) return ctx.toast('Escolha um modelo primeiro.', 'error');
        if (draft.favoriteModels.some((f) => f.providerId === draft.defaultProvider && f.model === m)) return ctx.toast('Esse modelo já está nos favoritos.', 'info');
        draft.favoriteModels.push({ providerId: draft.defaultProvider, model: m, label: '' });
        dirty(); ctx.rerender();
      })));

    // Sub-agentes por tipo (roteamento de modelo)
    const SUB = [
      ['explore', 'Explorador', 'Só leitura: responde "onde fica X?", "como funciona Y?". Um modelo barato/local costuma bastar.'],
      ['plan', 'Planejador', 'Só leitura: estuda o código e devolve um plano detalhado. Vale um modelo forte.'],
      ['general', 'Geral', 'Executa subtarefas completas (edita e roda comandos, com as mesmas regras de aprovação).'],
      ['frontend', 'Frontend', 'Especialista em interfaces (web e mobile).'],
    ];
    draft.subagentMaxSteps = { explore: 15, plan: 20, general: 30, frontend: 30, ...(draft.subagentMaxSteps || {}) };
    const exSection = section('Sub-agentes (roteamento de modelo)', 'O agente principal pode delegar partes da tarefa. Escolha qual modelo cada tipo usa — por exemplo, planejar com um modelo forte e explorar com um local e grátis.',
      ...SUB.map(([type, label, help]) => {
        const r = draft.routing[type] = draft.routing[type] || { providerId: '', model: '' };
        return el('div', { class: 'lgx-item' },
          el('div', { class: 'lgx-title' }, label), el('div', { class: 'lgx-sub' }, help),
          el('div', { class: 'lgx-grid3' },
            field('Provedor', providerSelect(draft, ctx, r.providerId, (v) => { r.providerId = v; if (!v) r.model = ''; dirty(); ctx.rerender(); }, { allowEmpty: true })),
            r.providerId
              ? field('Modelo', modelPicker({ draft, ctx, getProvider: () => r.providerId, value: r.model, placeholder: `padrão: ${draft.providers[r.providerId]?.model || ''}`, onInput: (v) => { r.model = v; dirty(); } }))
              : field('Modelo', el('input', { type: 'text', disabled: true, value: 'o mesmo do agente' })),
            field('Máx. de passos', el('input', { type: 'number', min: '1', max: '200', value: draft.subagentMaxSteps[type], oninput: (e) => { draft.subagentMaxSteps[type] = Number(e.target.value) || 15; dirty(); } }))));
      }));

    // Parâmetros
    const mp = draft.modelParams;
    const genSection = section('Parâmetros de geração', 'Aplicados a todos os provedores. Deixe em branco para usar o padrão de cada um.',
      el('div', { class: 'lgx-grid3' },
        field('Temperatura', el('input', { type: 'number', min: '0', max: '2', step: '0.05', placeholder: 'padrão', value: mp.temperature ?? '',
          oninput: (e) => { const v = e.target.value; mp.temperature = v === '' ? null : Number(v); dirty(); } }), 'Claude aceita até 1 (valores maiores são limitados).'),
        field('Máximo de tokens na resposta', el('input', { type: 'number', min: '256', step: '256', placeholder: '16000', value: mp.maxTokens ?? 16000,
          oninput: (e) => { mp.maxTokens = e.target.value === '' ? 16000 : Number(e.target.value); dirty(); } }), 'Com 16000 (padrão), OpenAI e Gemini usam o limite do próprio modelo.'),
        field('Esforço de raciocínio', el('select', { value: mp.reasoningEffort || '', onchange: (e) => { mp.reasoningEffort = e.target.value; dirty(); } },
          el('option', { value: '' }, 'Padrão'), el('option', { value: 'minimal' }, 'Mínimo'), el('option', { value: 'low' }, 'Baixo'), el('option', { value: 'medium' }, 'Médio'), el('option', { value: 'high' }, 'Alto')),
          'Enviado como reasoning_effort a APIs compatíveis com OpenAI (modelos de raciocínio).')));

    // Favoritos
    if (!favForm.providerId || !draft.providers[favForm.providerId]) favForm.providerId = draft.defaultProvider;
    const favs = draft.favoriteModels;
    const favList = favs.length
      ? el('div', { class: 'lgx-list' }, favs.map((f, i) => {
        const isDefault = f.providerId === draft.defaultProvider && draft.providers[f.providerId]?.model === f.model;
        return el('div', { class: 'lgx-item' }, el('div', { class: 'lgx-head' },
          el('span', { class: 'lgx-star' }, '★'),
          el('div', { class: 'lgx-grow' },
            el('div', { class: 'lgx-title' }, f.label || f.model),
            el('div', { class: 'lgx-sub' }, `${providerLabel(draft, f.providerId)} · ${f.model}`)),
          !draft.providers[f.providerId] ? el('span', { class: 'lgx-badge warn' }, 'provedor removido') : null,
          isDefault ? el('span', { class: 'lgx-badge accent' }, 'padrão') : btn('Usar como padrão', () => {
            if (!draft.providers[f.providerId]) return ctx.toast('Esse provedor não existe mais.', 'error');
            draft.defaultProvider = f.providerId; draft.providers[f.providerId].model = f.model; dirty(); ctx.rerender();
          }, 'small', { disabled: !draft.providers[f.providerId] }),
          btn('Remover', () => { favs.splice(i, 1); dirty(); ctx.rerender(); }, 'small')));
      }))
      : el('div', { class: 'lgx-empty' }, 'Nenhum favorito ainda. Adicione os modelos que você mais usa para trocar rápido.');
    const favSection = section('Modelos favoritos', 'Atalhos para os modelos que você mais usa.', favList,
      el('div', { class: 'row' },
        field('Provedor', providerSelect(draft, ctx, favForm.providerId, (v) => { favForm.providerId = v; ctx.rerender(); })),
        field('Modelo', modelPicker({ draft, ctx, getProvider: () => favForm.providerId, value: favForm.model, onInput: (v) => { favForm.model = v; } }))),
      el('div', { class: 'lgx-inline' },
        el('input', { type: 'text', placeholder: 'Apelido (opcional), ex.: "Rápido e barato"', value: favForm.label, oninput: (e) => { favForm.label = e.target.value; } }),
        btn('Adicionar favorito', () => {
          if (!favForm.model) return ctx.toast('Informe o modelo.', 'error');
          if (favs.some((f) => f.providerId === favForm.providerId && f.model === favForm.model)) return ctx.toast('Esse modelo já está nos favoritos.', 'info');
          favs.push({ providerId: favForm.providerId, model: favForm.model, label: favForm.label.trim() });
          favForm.model = ''; favForm.label = '';
          dirty(); ctx.rerender();
        }, 'small primary')));

    container.replaceChildren(el('div', { class: 'lgx-tab' }, defSection, exSection, genSection, favSection));
  }

  // ---------------------------------------------------------------- aba MCP
  const mcp = { status: {}, expanded: new Set(), tests: {}, renames: {}, importOpen: false, importText: '', root: null, poll: null, testing: new Set() };

  const TEMPLATES = [
    { id: 'filesystem', label: 'Sistema de arquivos', make: () => ({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', mcp.root || '.'], env: {} }) },
    { id: 'fetch', label: 'Fetch (páginas web)', make: () => ({ type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], env: {} }) },
    { id: 'memory', label: 'Memória', make: () => ({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: {} }) },
    { id: 'playwright', label: 'Playwright (navegador)', make: () => ({ type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: {} }) },
    { id: 'github', label: 'GitHub (remoto)', make: () => ({ type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer <seu token do GitHub>' } }) },
    { id: 'novo-servidor', label: 'Personalizado', make: () => ({ type: 'stdio', command: '', args: [], env: {} }) },
  ];

  const STATUS = {
    connected: ['ok', 'Conectado'], error: ['err', 'Erro'], disabled: ['', 'Desligado'], connecting: ['warn', 'Conectando…'],
  };

  const parsePairs = (text, sep) => {
    const out = {};
    for (const line of String(text).split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf(sep);
      if (i <= 0) continue;
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
  };
  const pairsText = (obj, sep) => Object.entries(obj || {}).map(([k, v]) => `${k}${sep}${v}`).join('\n');

  function normalizeImported(s) {
    const isHttp = s.type === 'http' || s.type === 'streamable-http' || s.type === 'sse' || (!s.command && s.url);
    const out = { enabled: s.enabled !== false && s.disabled !== true, type: isHttp ? 'http' : 'stdio', trusted: !!s.trusted };
    if (isHttp) { out.url = String(s.url || ''); out.headers = { ...(s.headers || {}) }; }
    else { out.command = String(s.command || ''); out.args = Array.isArray(s.args) ? s.args.map(String) : []; out.env = { ...(s.env || {}) }; }
    return out;
  }

  const uniqueName = (servers, base) => { let n = base, i = 2; while (servers[n]) n = `${base}-${i++}`; return n; };

  async function fetchStatus(ctx) {
    try {
      const r = await ctx.api('/api/mcp');
      mcp.status = Object.fromEntries((r.servers || []).map((s) => [s.name, s]));
    } catch {}
  }

  function paintStatus(container, draft) {
    for (const node of container.querySelectorAll('[data-mcp]')) {
      const name = node.getAttribute('data-mcp');
      const st = statusFor(name, draft);
      const dot = node.querySelector('.lgx-dot');
      const txt = node.querySelector('[data-mcp-text]');
      if (dot) dot.className = `lgx-dot ${st.cls}`;
      if (txt) txt.textContent = st.text;
    }
  }

  function statusFor(name, draft) {
    const srv = draft.mcpServers[name];
    const saved = mcp.status[name] || mcp.status[mcp.renames[name]];
    if (!saved) return { cls: '', text: srv?.enabled === false ? 'Desligado' : 'Não salvo — clique em Salvar para conectar' };
    const [cls, label] = STATUS[saved.status] || ['', saved.status];
    let text = label;
    if (saved.status === 'connected') text += ` · ${saved.toolCount} ferramenta(s)`;
    if (saved.status === 'connected' && saved.serverInfo?.name) text += ` · ${saved.serverInfo.name}${saved.serverInfo.version ? ' ' + saved.serverInfo.version : ''}`;
    if (srv && saved.enabled !== (srv.enabled !== false)) text += ' (alteração pendente: salve)';
    return { cls, text, saved };
  }

  function renderMcp(container, draft, ctx) {
    draft.mcpServers = draft.mcpServers && typeof draft.mcpServers === 'object' ? draft.mcpServers : {};
    const servers = draft.mcpServers;
    const dirty = () => ctx.markDirty();
    if (mcp.root === null) { mcp.root = ''; ctx.api('/api/state').then((s) => { mcp.root = s.root || ''; }).catch(() => {}); }

    const addServer = (base, srv) => {
      const name = uniqueName(servers, base);
      servers[name] = { enabled: true, trusted: false, ...srv };
      mcp.expanded.add(name);
      dirty(); ctx.rerender();
    };

    const renameServer = (oldName, newName) => {
      newName = newName.trim();
      if (!newName || newName === oldName) return false;
      if (servers[newName]) { ctx.toast(`Já existe um servidor chamado "${newName}".`, 'error'); return false; }
      const entries = Object.entries(servers).map(([k, v]) => [k === oldName ? newName : k, v]);
      for (const k of Object.keys(servers)) delete servers[k];
      for (const [k, v] of entries) servers[k] = v;
      mcp.renames[newName] = mcp.renames[oldName] || oldName;
      delete mcp.renames[oldName];
      if (mcp.expanded.delete(oldName)) mcp.expanded.add(newName);
      if (mcp.tests[oldName]) { mcp.tests[newName] = mcp.tests[oldName]; delete mcp.tests[oldName]; }
      dirty();
      return true;
    };

    const test = async (name) => {
      mcp.testing.add(name); ctx.rerender();
      try {
        mcp.tests[name] = await ctx.api('/api/mcp/test', { method: 'POST', body: { name, originalName: mcp.renames[name] || name, server: servers[name] } });
        ctx.toast(mcp.tests[name].ok ? `"${name}": ${mcp.tests[name].tools.length} ferramenta(s) encontrada(s).` : `"${name}": falha na conexão.`, mcp.tests[name].ok ? 'ok' : 'error');
      } catch (e) { mcp.tests[name] = { ok: false, error: e.message }; }
      mcp.testing.delete(name);
      mcp.expanded.add(name);
      ctx.rerender();
    };

    const restart = async (name) => {
      try {
        const s = await ctx.api(`/api/mcp/${encodeURIComponent(name)}/restart`, { method: 'POST' });
        mcp.status[name] = s;
        ctx.toast(s.status === 'connected' ? `"${name}" reiniciado.` : `"${name}": ${s.error || s.status}`, s.status === 'connected' ? 'ok' : 'error');
      } catch (e) { ctx.toast(e.message, 'error'); }
      ctx.rerender();
    };

    const card = (name) => {
      const srv = servers[name];
      const open = mcp.expanded.has(name);
      const st = statusFor(name, draft);
      const saved = st.saved;
      const tr = mcp.tests[name];
      const isSaved = !!mcp.status[name] && !mcp.renames[name];
      const head = el('div', { class: 'lgx-head', 'data-mcp': name },
        el('span', { class: `lgx-dot ${st.cls}` }),
        el('div', { class: 'lgx-grow' },
          el('div', { class: 'lgx-title' }, name),
          el('div', { class: 'lgx-sub', 'data-mcp-text': '' }, st.text)),
        el('span', { class: 'lgx-badge' }, srv.type === 'http' ? 'HTTP' : 'stdio'),
        srv.trusted ? el('span', { class: 'lgx-badge violet', title: 'Ferramentas deste servidor não pedem aprovação' }, 'confiável') : null,
        el('label', { class: 'lgx-switch', title: 'Ligar/desligar (vale ao Salvar)' },
          el('input', { type: 'checkbox', checked: srv.enabled !== false, onchange: (e) => { srv.enabled = e.target.checked; dirty(); ctx.rerender(); } }), 'Ativo'),
        btn(mcp.testing.has(name) ? 'Testando…' : 'Testar', () => test(name), 'small', { disabled: mcp.testing.has(name) }),
        isSaved && srv.enabled !== false ? btn('Reiniciar', () => restart(name)) : null,
        btn(open ? 'Fechar' : 'Editar', () => { open ? mcp.expanded.delete(name) : mcp.expanded.add(name); ctx.rerender(); }),
        btn('Remover', () => {
          if (!confirm(`Remover o servidor MCP "${name}"?`)) return;
          delete servers[name]; mcp.expanded.delete(name); delete mcp.tests[name]; dirty(); ctx.rerender();
        }, 'small lgx-danger'));

      const body = [];
      if (saved?.status === 'error' && saved.error) {
        body.push(el('div', { class: 'lgx-error' }, saved.error));
        if (saved.stderr?.length) body.push(el('details', null, el('summary', null, 'Últimas linhas do log (stderr)'), el('pre', { class: 'lgx-pre' }, saved.stderr.join('\n'))));
      } else if (saved?.status === 'connected' && saved.tools?.length && open) {
        body.push(el('details', null, el('summary', null, `Ferramentas disponíveis aos agentes (${saved.tools.length})`),
          el('div', { class: 'lgx-tools', style: { marginTop: '6px' } }, saved.tools.map((t) => el('span', { class: 'lgx-tool' }, t)))));
      }

      if (open) {
        const nameInput = el('input', { type: 'text', value: name, spellcheck: 'false', onchange: (e) => { if (renameServer(name, e.target.value)) ctx.rerender(); else e.target.value = name; } });
        const typeSel = el('select', { value: srv.type === 'http' ? 'http' : 'stdio', onchange: (e) => {
          srv.type = e.target.value;
          if (srv.type === 'http') { srv.url = srv.url || ''; srv.headers = srv.headers || {}; } else { srv.command = srv.command || ''; srv.args = srv.args || []; srv.env = srv.env || {}; }
          dirty(); ctx.rerender();
        } }, el('option', { value: 'stdio' }, 'Processo local (stdio)'), el('option', { value: 'http' }, 'Remoto (Streamable HTTP)'));
        body.push(el('div', { class: 'row' }, field('Nome', nameInput, 'Ferramentas aparecem como mcp__nome__ferramenta.'), field('Tipo', typeSel)));
        if (srv.type === 'http') {
          body.push(field('URL', el('input', { type: 'url', value: srv.url || '', placeholder: 'https://exemplo.com/mcp', spellcheck: 'false', oninput: (e) => { srv.url = e.target.value.trim(); dirty(); } })));
          body.push(field('Cabeçalhos', el('textarea', { class: 'lgx-mono', rows: 3, spellcheck: 'false', placeholder: 'Authorization: Bearer seu-token', value: pairsText(srv.headers, ': '),
            oninput: (e) => { srv.headers = parsePairs(e.target.value, ':'); dirty(); } }), 'Um por linha, no formato Nome: valor. Valores secretos aparecem mascarados e são preservados.'));
        } else {
          body.push(field('Comando', el('input', { type: 'text', class: 'lgx-mono', value: srv.command || '', placeholder: 'npx, uvx, node, python, docker…', spellcheck: 'false', oninput: (e) => { srv.command = e.target.value.trim(); dirty(); } }),
            'Executado na pasta do projeto, com o PATH do seu shell.'));
          body.push(el('div', { class: 'row' },
            field('Argumentos', el('textarea', { class: 'lgx-mono', rows: 4, spellcheck: 'false', placeholder: '-y\n@pacote/servidor', value: (srv.args || []).join('\n'),
              oninput: (e) => { srv.args = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); dirty(); } }), 'Um argumento por linha.'),
            field('Variáveis de ambiente', el('textarea', { class: 'lgx-mono', rows: 4, spellcheck: 'false', placeholder: 'API_KEY=valor', value: pairsText(srv.env, '='),
              oninput: (e) => { srv.env = parsePairs(e.target.value, '='); dirty(); } }), 'CHAVE=valor, uma por linha. Segredos aparecem mascarados e são preservados.')));
        }
        body.push(el('label', { class: 'lgx-check' },
          el('input', { type: 'checkbox', checked: !!srv.trusted, onchange: (e) => { srv.trusted = e.target.checked; dirty(); ctx.rerender(); } }),
          el('span', null, el('b', null, 'Confiável (não pedir aprovação)'), el('br'), el('span', { class: 'muted' }, 'Sem isto, cada chamada de ferramenta deste servidor pede sua aprovação nos modos "Pedir antes de comandos" e "Pedir antes de qualquer alteração".'))));
      }

      if (tr) {
        if (tr.ok) {
          body.push(el('div', { class: 'lgx-ok' }, `✓ Conectou em ${tr.ms} ms${tr.serverInfo?.name ? ` (${tr.serverInfo.name}${tr.serverInfo.version ? ' ' + tr.serverInfo.version : ''})` : ''} — ${tr.tools.length} ferramenta(s):`));
          body.push(tr.tools.length
            ? el('div', { class: 'lgx-tools' }, tr.tools.map((t) => el('span', { class: 'lgx-tool', title: t.description || '' }, t.name)))
            : el('div', { class: 'muted' }, 'O servidor não expõe ferramentas.'));
        } else {
          body.push(el('div', { class: 'lgx-error' }, `✗ ${tr.error}`));
          if (tr.stderr?.length) body.push(el('pre', { class: 'lgx-pre' }, tr.stderr.join('\n')));
        }
      }
      return el('div', { class: `lgx-item${open ? ' lgx-open' : ''}` }, head, body);
    };

    const names = Object.keys(servers);
    const list = names.length ? el('div', { class: 'lgx-list' }, names.map(card)) : el('div', { class: 'lgx-empty' }, 'Nenhum servidor MCP. Adicione um modelo pronto abaixo, cole um JSON ou crie um personalizado.');

    const importBox = mcp.importOpen ? el('div', { class: 'lgx-item' },
      field('Cole o JSON de configuração', el('textarea', { class: 'lgx-mono', rows: 8, spellcheck: 'false', value: mcp.importText,
        placeholder: '{\n  "mcpServers": {\n    "meu-servidor": { "command": "npx", "args": ["-y", "pacote"], "env": {} }\n  }\n}',
        oninput: (e) => { mcp.importText = e.target.value; } }), 'Aceita { "mcpServers": { ... } }, { "servers": { ... } } ou o mapa de servidores diretamente.'),
      el('div', { class: 'lgx-actions' },
        btn('Importar', () => {
          let j;
          try { j = JSON.parse(mcp.importText); } catch (e) { return ctx.toast(`JSON inválido: ${e.message}`, 'error'); }
          const map = j?.mcpServers || j?.servers || j;
          if (!map || typeof map !== 'object' || Array.isArray(map)) return ctx.toast('Formato não reconhecido.', 'error');
          let added = 0, updated = 0;
          for (const [n, s] of Object.entries(map)) {
            if (!s || typeof s !== 'object' || (!s.command && !s.url)) continue;
            const name = n.trim().slice(0, 64);
            if (!name) continue;
            if (servers[name]) updated++; else added++;
            servers[name] = normalizeImported(s);
          }
          if (!added && !updated) return ctx.toast('Nenhum servidor encontrado no JSON (cada um precisa de "command" ou "url").', 'error');
          mcp.importOpen = false; mcp.importText = '';
          dirty(); ctx.rerender();
          ctx.toast(`${added} servidor(es) adicionado(s)${updated ? `, ${updated} atualizado(s)` : ''}. Clique em Salvar para conectar.`, 'ok');
        }, 'small primary'),
        btn('Cancelar', () => { mcp.importOpen = false; ctx.rerender(); }))) : null;

    const tab = el('div', { class: 'lgx-tab' },
      section('Servidores MCP', 'O Model Context Protocol conecta os agentes a ferramentas externas (bancos de dados, navegador, GitHub…). Ligar, desligar e editar valem ao Salvar; "Testar" usa o que está na tela, sem salvar.',
        el('div', { class: 'lgx-actions' },
          btn('+ Adicionar servidor', () => addServer('novo-servidor', TEMPLATES.at(-1).make()), 'small primary'),
          btn('Importar JSON', () => { mcp.importOpen = !mcp.importOpen; ctx.rerender(); }),
          el('span', { class: 'lgx-spacer' }),
          btn('Atualizar status', async () => { await fetchStatus(ctx); ctx.rerender(); })),
        importBox, list),
      section('Modelos prontos', 'Adicione com um clique e ajuste os argumentos. Requer Node.js (npx) ou uv (uvx) instalados.',
        el('div', { class: 'lgx-chips' }, TEMPLATES.map((t) => el('button', { type: 'button', class: 'lgx-chip', onclick: () => addServer(t.id, t.make()) }, `+ ${t.label}`)))));
    container.replaceChildren(tab);

    // Status ao vivo enquanto a aba estiver aberta (só repinta as bolinhas, sem tirar o foco).
    mcp.view = { container, draft };
    if (!mcp.poll) {
      fetchStatus(ctx).then(() => { if (mcp.view.container.isConnected) ctx.rerender(); });
      mcp.poll = setInterval(async () => {
        if (!mcp.view.container.isConnected) { clearInterval(mcp.poll); mcp.poll = null; return; }
        await fetchStatus(ctx);
        if (mcp.view.container.isConnected) paintStatus(mcp.view.container, mcp.view.draft);
      }, 3000);
    }
  }

  // ---------------------------------------------------------------- aba Skills
  const sk = { data: null, loading: false, fetchedAt: 0, editing: null, creating: null };
  const SKILL_TEMPLATE = `# Título da skill

## Quando usar
Descreva em que situações o agente deve seguir estas instruções.

## Instruções
1. Primeiro passo
2. Segundo passo
3. Como verificar o resultado

## Arquivos de apoio
Coloque modelos, exemplos ou scripts nesta pasta e cite-os aqui (ex.: \`modelos/relatorio.md\`).
`;

  async function loadSkills(ctx, force) {
    if (sk.loading || (!force && sk.data && Date.now() - sk.fetchedAt < 4000)) return false;
    sk.loading = true;
    try { sk.data = await ctx.api('/api/skills'); }
    catch (e) { sk.data = { error: e.message, skills: [], dirs: {} }; }
    sk.loading = false; sk.fetchedAt = Date.now();
    return true;
  }

  function renderSkills(container, draft, ctx) {
    draft.skills = draft.skills && typeof draft.skills === 'object' ? draft.skills : {};
    draft.skills.disabled = Array.isArray(draft.skills.disabled) ? draft.skills.disabled : [];
    const disabled = draft.skills.disabled;
    // Recarrega a lista ao abrir a aba (não enquanto o usuário edita, para não tirar o foco).
    if (!sk.data || (!sk.editing && !sk.creating && Date.now() - sk.fetchedAt > 4000)) {
      loadSkills(ctx).then((changed) => { if (changed && container.isConnected && !sk.editing && !sk.creating) ctx.rerender(); });
      if (!sk.data) { container.replaceChildren(el('div', { class: 'lgx-tab' }, el('div', { class: 'lgx-empty' }, 'Carregando skills…'))); return; }
    }
    const data = sk.data;
    const refresh = async () => { await loadSkills(ctx, true); ctx.rerender(); };
    const pathRow = (p) => el('div', { class: 'lgx-path' }, el('code', { title: p }, p), btn('Copiar', () => copyText(p, ctx.toast)));

    const openEditor = async (s) => {
      try {
        const r = await ctx.api(`/api/skills/${s.scope}/${encodeURIComponent(s.folder)}`);
        sk.editing = { scope: s.scope, folder: s.folder, content: r.content, files: r.files || [], original: r.content };
        ctx.rerender();
      } catch (e) { ctx.toast(e.message, 'error'); }
    };

    const items = (data.skills || []).map((s) => {
      const isActive = !disabled.includes(s.name);
      const editing = sk.editing && sk.editing.scope === s.scope && sk.editing.folder === s.folder;
      const head = el('div', { class: 'lgx-head' },
        el('label', { class: 'lgx-switch', title: 'Ativar/desativar (vale ao Salvar)' },
          el('input', { type: 'checkbox', checked: isActive, onchange: (e) => {
            const i = disabled.indexOf(s.name);
            if (e.target.checked && i >= 0) disabled.splice(i, 1);
            if (!e.target.checked && i < 0) disabled.push(s.name);
            ctx.markDirty(); ctx.rerender();
          } })),
        el('div', { class: 'lgx-grow' },
          el('div', { class: 'lgx-title' }, s.name),
          el('div', { class: 'lgx-sub', title: s.description }, s.description || 'Sem descrição — o agente não saberá quando usar.')),
        el('span', { class: `lgx-badge ${s.scope === 'project' ? 'accent' : 'violet'}` }, s.scope === 'project' ? 'Projeto' : 'Global'),
        s.shadowed ? el('span', { class: 'lgx-badge warn', title: 'Uma skill do projeto com o mesmo nome tem prioridade' }, 'substituída') : null,
        !isActive ? el('span', { class: 'lgx-badge' }, 'desativada') : null,
        btn(editing ? 'Fechar' : 'Editar', () => { if (editing) { sk.editing = null; ctx.rerender(); } else openEditor(s); }),
        btn('Excluir', async () => {
          if (!confirm(`Excluir a skill "${s.name}" (${s.scope === 'project' ? 'do projeto' : 'global'})?\nA pasta inteira será apagada:\n${s.path}`)) return;
          try {
            await ctx.api(`/api/skills/${s.scope}/${encodeURIComponent(s.folder)}`, { method: 'DELETE' });
            if (editing) sk.editing = null;
            ctx.toast(`Skill "${s.name}" excluída.`, 'ok');
            await refresh();
          } catch (e) { ctx.toast(e.message, 'error'); }
        }, 'small lgx-danger'));
      const body = [pathRow(s.path)];
      if (editing) {
        const e = sk.editing;
        body.push(field('SKILL.md', el('textarea', { class: 'lgx-mono', rows: 18, spellcheck: 'false', value: e.content, oninput: (ev) => { e.content = ev.target.value; } }),
          'O frontmatter (entre ---) precisa ter name e description. O corpo só é carregado quando o agente usa a skill.'));
        if (e.files.length) body.push(el('details', null, el('summary', null, `Arquivos de apoio (${e.files.length})`), el('div', { class: 'lgx-tools', style: { marginTop: '6px' } }, e.files.map((f) => el('span', { class: 'lgx-tool' }, f)))));
        body.push(el('div', { class: 'lgx-actions' },
          btn('Salvar skill', async () => {
            try {
              await ctx.api(`/api/skills/${e.scope}/${encodeURIComponent(e.folder)}`, { method: 'PUT', body: { content: e.content } });
              ctx.toast('Skill salva.', 'ok');
              sk.editing = null;
              await refresh();
            } catch (err) { ctx.toast(err.message, 'error'); }
          }, 'small primary'),
          btn('Cancelar', () => { sk.editing = null; ctx.rerender(); }),
          el('span', { class: 'muted', style: { fontSize: '11.5px' } }, 'Salva direto no arquivo (não depende do botão Salvar das configurações).')));
      }
      return el('div', { class: `lgx-item${editing ? ' lgx-open' : ''}` }, head, body);
    });

    let createBox = null;
    if (sk.creating) {
      const c = sk.creating;
      const valid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.name);
      createBox = el('div', { class: 'lgx-item lgx-open' },
        el('div', { class: 'row' },
          field('Nome', el('input', { type: 'text', class: 'lgx-mono', value: c.name, placeholder: 'revisar-codigo', spellcheck: 'false',
            oninput: (e) => { c.name = e.target.value.trim(); } }), 'kebab-case: letras minúsculas, números e hífens.'),
          field('Onde salvar', el('select', { value: c.scope, onchange: (e) => { c.scope = e.target.value; } },
            el('option', { value: 'project' }, 'Neste projeto (.lastgravity/skills)'), el('option', { value: 'global' }, 'Global (todos os projetos)')))),
        field('Descrição', el('input', { type: 'text', value: c.description, placeholder: 'Use quando… (o agente decide pela descrição se deve carregar a skill)', oninput: (e) => { c.description = e.target.value; } })),
        field('Instruções', el('textarea', { class: 'lgx-mono', rows: 14, spellcheck: 'false', value: c.body, oninput: (e) => { c.body = e.target.value; } })),
        el('div', { class: 'lgx-actions' },
          btn('Criar skill', async () => {
            if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.name)) return ctx.toast('Nome inválido: use kebab-case, ex.: "gerar-relatorio".', 'error');
            if (!c.description.trim()) return ctx.toast('Escreva uma descrição.', 'error');
            try {
              await ctx.api('/api/skills', { method: 'POST', body: { name: c.name, description: c.description.trim(), body: c.body, scope: c.scope } });
              ctx.toast(`Skill "${c.name}" criada.`, 'ok');
              sk.creating = null;
              await refresh();
            } catch (e) { ctx.toast(e.message, 'error'); }
          }, 'small primary'),
          btn('Cancelar', () => { sk.creating = null; ctx.rerender(); }),
          !valid && c.name ? el('span', { class: 'lgx-error' }, 'Nome fora do padrão kebab-case.') : null));
    }

    const tab = el('div', { class: 'lgx-tab' },
      section('Skills', 'Pacotes de instruções que o agente carrega sob demanda: o prompt lista só nome e descrição, e o conteúdo completo entra quando o agente chama use_skill. Ligar/desligar vale ao Salvar.',
        el('div', { class: 'lgx-actions' },
          btn('+ Nova skill', () => { sk.creating = sk.creating || { name: '', description: '', scope: 'project', body: SKILL_TEMPLATE }; ctx.rerender(); }, 'small primary'),
          el('span', { class: 'lgx-spacer' }),
          btn('Recarregar', refresh)),
        data.error ? el('div', { class: 'lgx-error' }, data.error) : null,
        createBox,
        items.length ? el('div', { class: 'lgx-list' }, items) : (createBox ? null : el('div', { class: 'lgx-empty' }, 'Nenhuma skill encontrada. Crie uma ou coloque pastas com SKILL.md nas pastas abaixo.'))),
      section('Pastas de skills', 'Cada skill é uma pasta com um SKILL.md e, opcionalmente, arquivos de apoio. O navegador não pode abrir pastas: copie o caminho e abra no Finder/Explorer ou no terminal.',
        field('Global', pathRow(data.dirs?.global || '')),
        field('Deste projeto', pathRow(data.dirs?.project || ''))));
    container.replaceChildren(tab);
  }

  // ---------------------------------------------------------------- registro
  function boot() {
    const LG = window.LG;
    if (!LG || typeof LG.registerSettingsTab !== 'function') return setTimeout(boot, 50);
    if (!document.getElementById('lgx-style')) document.head.append(el('style', { id: 'lgx-style' }, STYLE));
    const safe = (fn, label) => (container, draft, ctx) => {
      try { fn(container, draft, ctx); }
      catch (e) { console.error(e); container.replaceChildren(el('div', { class: 'lgx-error' }, `Erro ao desenhar a aba ${label}: ${e.message}`)); }
    };
    LG.registerSettingsTab({ id: 'models', label: 'Modelos', icon: '◆', order: 15, render: safe(renderModels, 'Modelos') });
    LG.registerSettingsTab({ id: 'mcp', label: 'MCP', icon: '⧉', order: 30, render: safe(renderMcp, 'MCP') });
    LG.registerSettingsTab({ id: 'skills', label: 'Skills', icon: '✦', order: 40, render: safe(renderSkills, 'Skills') });
  }
  boot();
})();
