// LastGravity — interface (JS puro, sem build).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => esc(s)
  .replace(/```[\w-]*\n?([\s\S]*?)```/g, (m, c) => `<pre class="code">${c}</pre>`)
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  .replace(/^#{1,4} (.*)$/gm, '<b class="h">$1</b>')
  .replace(/^[-*] (.*)$/gm, '• $1');
const clone = (o) => JSON.parse(JSON.stringify(o));
const isLocal = (u) => /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(u || '');

async function api(path, opts = {}) {
  const res = await fetch(path, { method: opts.method || 'GET', headers: { 'content-type': 'application/json', 'x-lastgravity': '1' }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

function toast(msg, kind = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

const S = {
  config: null, agents: {}, full: {}, selected: null, view: 'editor',
  files: new Map(), current: null, monaco: null, editor: null, expanded: new Set(),
};
const STATUS = { idle: 'Ocioso', running: 'Trabalhando', awaiting_approval: 'Aguardando você', done: 'Concluído', error: 'Erro' };
const APPROVAL = { auto: 'Autônomo', 'ask-commands': 'Pedir p/ comandos', 'ask-all': 'Pedir p/ tudo' };
const statusTag = (s) => `<span class="status ${s}">${STATUS[s] || s}</span>`;
const timeAgo = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}min` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };
const ED = () => S.config?.editor || {};

/* ---------- Modo desktop ---------- */
const DESKTOP = new URLSearchParams(location.search).get('desktop');
if (DESKTOP) document.body.classList.add('desktop', `desktop-${DESKTOP}`);

/* ---------- Monaco: cópia local (offline) e, se faltar, CDN ---------- */
const CDN_VS = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';
function injectScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
}
async function loadMonaco() {
  let base = new URL('vendor/vs', location.href).href; // absoluto: os workers do Monaco exigem
  try { await injectScript(`${base}/loader.js`); }
  catch { if (DESKTOP) return null; base = CDN_VS; try { await injectScript(`${base}/loader.js`); } catch { return null; } }
  const m = await new Promise((resolve) => {
    window.require.config({ paths: { vs: base } });
    window.require(['vs/editor/editor.main'], () => resolve(window.monaco), () => resolve(null));
    setTimeout(() => resolve(window.monaco || null), 15000);
  });
  m?.editor.defineTheme('lastgravity', {
    base: 'vs-dark', inherit: true, rules: [],
    colors: { 'editor.background': '#0f1117', 'editor.lineHighlightBackground': '#161922', 'editorGutter.background': '#0f1117', 'editorLineNumber.foreground': '#4b5165', 'editor.selectionBackground': '#3b2f5c', 'minimap.background': '#0f1117', 'scrollbarSlider.background': '#2a2f3f88', 'diffEditor.insertedTextBackground': '#34d39926', 'diffEditor.removedTextBackground': '#f8717126' },
  });
  return m;
}
const monacoReady = loadMonaco();

/* ---------- Editor ---------- */
const LANG = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', json: 'json', html: 'html', css: 'css', scss: 'scss', md: 'markdown', py: 'python', dart: 'dart', java: 'java', kt: 'kotlin', go: 'go', rs: 'rust', php: 'php', rb: 'ruby', sh: 'shell', yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql', c: 'c', cpp: 'cpp', cs: 'csharp', swift: 'swift' };
const langOf = (p) => LANG[p.split('.').pop().toLowerCase()] || 'plaintext';

function editorOptions() {
  const e = ED();
  return {
    theme: 'lastgravity', automaticLayout: true, fontSize: Number(e.fontSize) || 13,
    fontFamily: e.fontFamily || undefined, wordWrap: e.wordWrap || 'off', minimap: { enabled: !!e.minimap },
    lineNumbers: e.lineNumbers || 'on', renderWhitespace: e.renderWhitespace || 'none', cursorBlinking: e.cursorBlinking || 'blink',
    bracketPairColorization: { enabled: e.bracketPairs !== false }, smoothScrolling: e.smoothScrolling !== false, scrollBeyondLastLine: false,
  };
}
function applyEditorSettings() {
  const e = ED();
  document.documentElement.style.setProperty('--term-font', `${Number(e.terminalFontSize) || 12}px`);
  if (S.monaco && S.editor && !S.editor.fallback) {
    S.editor.updateOptions(editorOptions());
    for (const f of S.files.values()) f.model?.updateOptions({ tabSize: Number(e.tabSize) || 2, insertSpaces: e.insertSpaces !== false });
  }
}

function ensureEditor() {
  if (S.editor) return;
  const host = $('#editor-host');
  if (S.monaco) {
    S.editor = S.monaco.editor.create(host, editorOptions());
    S.editor.addCommand(S.monaco.KeyMod.CtrlCmd | S.monaco.KeyCode.KeyS, () => saveCurrent());
    S.editor.onDidBlurEditorWidget(() => { if (ED().autoSave === 'onFocusChange') saveAllDirty(); });
  } else {
    const ta = document.createElement('textarea');
    ta.className = 'fallback';
    ta.spellcheck = false;
    ta.addEventListener('input', () => { const f = S.files.get(S.current); if (f) { f.value = ta.value; f.dirty = f.value !== f.saved; renderTabs(); scheduleAutoSave(f); } });
    ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrent(); } });
    ta.addEventListener('blur', () => { if (ED().autoSave === 'onFocusChange') saveAllDirty(); });
    host.appendChild(ta);
    S.editor = { fallback: ta };
  }
}

function scheduleAutoSave(f) {
  if (ED().autoSave !== 'afterDelay') return;
  clearTimeout(f.timer);
  f.timer = setTimeout(() => { if (f.dirty) saveFile(f); }, Number(ED().autoSaveDelay) || 1000);
}

async function openFile(path, { focus = true } = {}) {
  if (!S.editor) S.monaco = await monacoReady;
  ensureEditor();
  if (!S.files.has(path)) {
    const { content } = await api(`/api/file?path=${encodeURIComponent(path)}`);
    const f = { path, value: content, saved: content, dirty: false };
    if (S.monaco) {
      f.model = S.monaco.editor.createModel(content, langOf(path));
      f.model.updateOptions({ tabSize: Number(ED().tabSize) || 2, insertSpaces: ED().insertSpaces !== false });
      f.model.onDidChangeContent(() => { f.dirty = f.model.getValue() !== f.saved; renderTabs(); scheduleAutoSave(f); });
    }
    S.files.set(path, f);
  }
  if (focus || !S.current) {
    S.current = path;
    const f = S.files.get(path);
    if (S.monaco) S.editor.setModel(f.model); else S.editor.fallback.value = f.value;
  }
  $('#editor-empty').classList.add('hidden');
  renderTabs(); renderTree();
}

function formatOnSave(text) {
  const e = ED();
  if (e.trimTrailingWhitespace) text = text.replace(/[ \t]+$/gm, '');
  if (e.insertFinalNewline && text && !text.endsWith('\n')) text += '\n';
  return text;
}
async function saveFile(f) {
  let content = f.model ? f.model.getValue() : f.value;
  const formatted = formatOnSave(content);
  if (formatted !== content) {
    content = formatted;
    if (f.model) { const pos = S.editor.getPosition?.(); f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text: content }], () => null); if (pos && S.current === f.path) S.editor.setPosition(pos); }
    else { f.value = content; if (S.current === f.path) S.editor.fallback.value = content; }
  }
  try {
    await api('/api/file', { method: 'PUT', body: { path: f.path, content } });
    f.saved = content; f.dirty = false; renderTabs();
  } catch (err) { toast(`Não foi possível salvar ${f.path}: ${err.message}`, 'error'); }
}
const saveCurrent = () => { const f = S.files.get(S.current); if (f) return saveFile(f); };
const saveAllDirty = () => Promise.all([...S.files.values()].filter((f) => f.dirty).map(saveFile));

function closeFile(path) {
  const f = S.files.get(path);
  if (f?.dirty && !confirm(`Descartar alterações não salvas em ${path}?`)) return;
  clearTimeout(f?.timer);
  f?.model?.dispose();
  S.files.delete(path);
  if (S.current === path) {
    S.current = null;
    const next = [...S.files.keys()].pop();
    if (next) openFile(next);
    else {
      if (S.editor && !S.editor.fallback) S.editor.setModel(null);
      else if (S.editor) S.editor.fallback.value = '';
      $('#editor-empty').classList.remove('hidden');
    }
  }
  renderTabs(); renderTree();
}

async function reloadFromDisk(path) {
  const f = S.files.get(path);
  if (!f || f.dirty) return;
  try {
    const { content } = await api(`/api/file?path=${encodeURIComponent(path)}`);
    if (content === f.saved) return;
    f.saved = content; f.value = content;
    if (f.model && f.model.getValue() !== content) f.model.setValue(content);
    if (!S.monaco && S.current === path) S.editor.fallback.value = content;
    f.dirty = false;
    renderTabs();
  } catch { f.dirty = false; closeFile(path); }
}

$('#tabs').addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.currentTarget.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
function renderTabs() {
  $('#tabs').innerHTML = [...S.files.values()].map((f) => `<div class="tab ${f.path === S.current ? 'active' : ''} ${f.dirty ? 'dirty' : ''}" tabindex="0" role="tab" aria-selected="${f.path === S.current}" data-path="${esc(f.path)}" title="${esc(f.path)}"><span class="name">${esc(f.path.split('/').pop())}</span><button type="button" class="x" data-close="${esc(f.path)}" aria-label="Fechar ${esc(f.path.split('/').pop())}">×</button></div>`).join('');
}
const _renderTabs = renderTabs;
renderTabs = function () { _renderTabs(); $('#tabs .tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); };
$('#tabs').addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) return closeFile(c.dataset.close);
  const t = e.target.closest('.tab');
  if (t) openFile(t.dataset.path);
});
$('#tabs').addEventListener('auxclick', (e) => { const t = e.target.closest('.tab'); if (t && e.button === 1) closeFile(t.dataset.path); });

/* ---------- Árvore de arquivos (carrega cada pasta só quando aberta) ---------- */
const TREE = new Map(); // caminho da pasta ('' = raiz) -> itens
const treeLoading = new Set();
async function loadDir(dir) {
  if (treeLoading.has(dir)) return;
  treeLoading.add(dir);
  try { TREE.set(dir, await api(`/api/tree?path=${encodeURIComponent(dir)}`)); }
  catch (e) { TREE.delete(dir); S.expanded.delete(dir); if (dir === '') toast(e.message, 'error'); }
  finally { treeLoading.delete(dir); }
}
async function loadTree() {
  await Promise.all(['', ...[...S.expanded].filter(Boolean)].map(loadDir));
  renderTree();
}
function renderTree() {
  const rows = [];
  const walk = (dir, depth) => {
    for (const n of TREE.get(dir) || []) {
      if (n.more) { rows.push(`<div class="node muted" style="padding-left:${8 + depth * 12}px">${esc(n.name)}</div>`); continue; }
      const open = S.expanded.has(n.path);
      rows.push(`<div class="node ${n.path === S.current ? 'active' : ''}" tabindex="0" role="treeitem" ${n.dir ? `aria-expanded="${open}"` : ''} style="padding-left:${8 + depth * 12}px" data-path="${esc(n.path)}" data-dir="${n.dir ? 1 : ''}" title="${esc(n.path)}"><span class="ic">${n.dir ? (open ? '▾' : '▸') : ''}</span>${esc(n.name)}</div>`);
      if (n.dir && open) {
        if (TREE.has(n.path)) walk(n.path, depth + 1);
        else rows.push(`<div class="node muted" style="padding-left:${20 + depth * 12}px">carregando…</div>`);
      }
    }
  };
  walk('', 0);
  $('#tree').innerHTML = rows.join('') || (TREE.has('') ? '<div class="placeholder">Pasta vazia</div>' : '<div class="placeholder">Carregando…</div>');
}
$('#tree').addEventListener('click', async (e) => {
  const n = e.target.closest('.node[data-path]');
  if (!n) return;
  const p = n.dataset.path;
  if (n.dataset.dir) {
    if (S.expanded.has(p)) { S.expanded.delete(p); renderTree(); return; }
    S.expanded.add(p); renderTree();
    if (!TREE.has(p)) { await loadDir(p); renderTree(); }
  } else openFile(p).catch((err) => toast(err.message, 'error'));
});
$('#btn-refresh').onclick = loadTree;
for (const id of ['#tree', '#tabs']) $(id).addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.node,.tab')) { e.preventDefault(); e.target.click(); } });
function revealInTree(path) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) S.expanded.add(parts.slice(0, i).join('/'));
  loadTree();
}

/* ---------- Terminal ---------- */
const termOut = $('#term-out');
const termHist = [];
let termIdx = 0;
$('#term-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const inp = $('#term-in');
  const cmd = inp.value.trim();
  if (!cmd || inp.disabled) return;
  inp.value = '';
  termHist.push(cmd); termIdx = termHist.length;
  if (cmd === 'clear' || cmd === 'cls') { termOut.textContent = ''; return; }
  termOut.textContent += `$ ${cmd}\n`;
  inp.disabled = true; $('#term-status').textContent = '· executando…';
  try { const r = await api('/api/exec', { method: 'POST', body: { command: cmd } }); termOut.textContent += r.output + (r.code ? `\n[saída ${r.code}]\n` : '\n'); }
  catch (err) { termOut.textContent += `Erro: ${err.message}\n`; }
  finally { inp.disabled = false; $('#term-status').textContent = ''; inp.focus(); }
  termOut.scrollTop = termOut.scrollHeight;
});
$('#term-in').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' && termIdx > 0) { e.preventDefault(); e.target.value = termHist[--termIdx]; }
  if (e.key === 'ArrowDown') { e.preventDefault(); termIdx = Math.min(termHist.length, termIdx + 1); e.target.value = termHist[termIdx] || ''; }
});

/* ---------- Agentes ---------- */
const sortedAgents = () => Object.values(S.agents).sort((a, b) => b.createdAt - a.createdAt);
const busy = (a) => a && (a.status === 'running' || a.status === 'awaiting_approval');
const PANES = () => [$('#panel-detail'), $('#manager-detail')];

async function selectAgent(id) {
  S.selected = id || null;
  if (id && !S.full[id]) { try { S.full[id] = await api(`/api/agents/${encodeURIComponent(id)}`); } catch (e) { toast(e.message, 'error'); } }
  renderAgents();
}

function renderAgents() {
  const list = sortedAgents();
  const waiting = list.filter((a) => a.status === 'awaiting_approval').length;
  $('#badge').textContent = waiting; $('#badge').classList.toggle('hidden', !waiting);
  $('#panel-agent').innerHTML = `<option value="">— escolha um agente —</option>` + list.map((a) => `<option value="${esc(a.id)}" ${a.id === S.selected ? 'selected' : ''}>${esc(a.title)} · ${STATUS[a.status]}</option>`).join('');
  renderInbox();
  renderStatusbar();
  const a = S.agents[S.selected];
  for (const el of PANES()) renderDetail(el, a, S.full[S.selected]);
  renderArtifacts(a);
}

function renderStatusbar() {
  const list = sortedAgents();
  const run = list.filter((a) => a.status === 'running').length, wait = list.filter((a) => a.status === 'awaiting_approval').length;
  $('#sb-agents').innerHTML = run || wait ? `${run ? `<span class="spin"></span> ${run} trabalhando` : ''}${run && wait ? ' · ' : ''}${wait ? `<span class="wait">${wait} aguardando você</span>` : ''}` : `${list.length} agente${list.length === 1 ? '' : 's'}`;
  const a = S.agents[S.selected];
  $('#sb-model').textContent = a ? providerLabel(a) : '';
  $('#sb-tokens').textContent = a ? `${((a.usage.input + a.usage.output) / 1000).toFixed(1)}k tok${a.usage.cost ? ` · US$ ${a.usage.cost.toFixed(3)}` : ''}` : '';
}
$('#sb-agents').onclick = () => setView('manager');

function renderInbox() {
  const list = sortedAgents();
  $('#inbox').innerHTML = list.map((a) => `<div class="inbox-item ${a.id === S.selected ? 'active' : ''}" data-id="${esc(a.id)}"><div class="t">${esc(a.title)}</div><div class="m">${statusTag(a.status)}<span>${esc(providerLabel(a))}</span><span>${timeAgo(a.updatedAt || a.createdAt)}</span></div></div>`).join('') || '<div class="placeholder">Nenhum agente ainda.<br>Clique em <b>+ Novo agente</b>.</div>';
}
setInterval(renderInbox, 30000);

const providerLabel = (a) => { const p = S.config?.providers[a.providerId]; return p ? `${p.label.replace(/ \(.*\)$/, '')} · ${a.model || p.model}` : a.providerId; };

function renderArtifacts(a) {
  $('#plan').innerHTML = a?.plan?.length ? a.plan.map((s) => `<div class="step ${esc(s.status)}">${s.status === 'done' ? '✔' : s.status === 'in_progress' ? '▶' : '○'} ${esc(s.title)}</div>`).join('') : '<span class="muted">Sem plano ainda.</span>';
  $('#changes').innerHTML = a?.changedFiles?.length
    ? a.changedFiles.map((p) => `<div class="change"><span title="${esc(p)}" data-open="${esc(p)}">${esc(p)}</span><button class="small" data-diff="${esc(p)}">diff</button></div>`).join('') + `<button class="small danger" id="btn-undo" style="margin-top:8px">↶ Desfazer tudo</button>`
    : '<span class="muted">Nenhuma alteração.</span>';
  const p = S.config?.providers[a?.providerId];
  $('#usage').innerHTML = a ? `<div><span>Entrada</span><b>${a.usage.input.toLocaleString('pt-BR')} tok</b></div><div><span>Saída</span><b>${a.usage.output.toLocaleString('pt-BR')} tok</b></div><div><span>Custo</span><b>${p?.priceIn || p?.priceOut ? 'US$ ' + a.usage.cost.toFixed(4) : '—'}</b></div><div><span>Modelo</span><b title="${esc(providerLabel(a))}">${esc(a.model || p?.model || '')}</b></div>` : '';
}

function toolArgs(t) {
  const a = t.args || {};
  if (t.name === 'run_command') return a.command;
  if (t.name === 'fetch_url') return a.url;
  if (t.name === 'search') return a.pattern;
  if (t.name === 'explore') return a.question;
  if (t.name === 'use_skill') return a.name;
  if (t.name === 'update_plan') return `${(a.steps || []).length} etapas`;
  return a.path || (t.name.startsWith('mcp__') ? JSON.stringify(a).slice(0, 80) : '');
}

// Cada item do histórico tem data-item = id, para ser atualizado sem redesenhar tudo.
// Como cada ferramenta aparece: ícone, verbo e alvo curto (estilo Claude/Antigravity).
const TOOL_UI = {
  read_file: ['📄', 'Leu', 'Leu'], write_file: ['✏️', 'Escreveu', 'Escreveu'], edit_file: ['✏️', 'Editou', 'Editou'],
  list_dir: ['📁', 'Listou', 'Listou'], glob: ['🔎', 'Procurou arquivos', 'Procurou'], search: ['🔎', 'Buscou', 'Buscou'],
  run_command: ['▶', 'Executou', 'Executou'], start_background: ['⏵', 'Iniciou processo', 'Iniciou'], stop_background: ['⏹', 'Parou processo', 'Parou'],
  read_process_log: ['📜', 'Leu log', 'Leu log'], list_processes: ['📜', 'Listou processos', 'Listou'],
  fetch_url: ['🌐', 'Abriu', 'Abriu'], web_search: ['🌐', 'Pesquisou', 'Pesquisou'], repo_map: ['🗺', 'Mapeou o projeto', 'Mapeou'],
  explore: ['🧭', 'Explorador', 'Explorou'], task: ['🧭', 'Sub-agente', 'Delegou'], update_plan: ['☑', 'Atualizou o plano', 'Plano'], use_skill: ['✦', 'Usou a skill', 'Skill'],
};
const toolUi = (name) => TOOL_UI[name] || (String(name).startsWith('mcp__') ? ['🔌', name.split('__').slice(1).join(' › '), 'MCP'] : ['⚙', name, name]);
function shortPath(p) {
  const s = String(p || '');
  const i = s.lastIndexOf('/');
  return i < 0 ? `<b>${esc(s)}</b>` : `<span class="dir">${esc(s.slice(0, i + 1))}</span><b>${esc(s.slice(i + 1))}</b>`;
}
function toolTarget(t) {
  const a = t.args || {};
  if (a.path && ['read_file', 'write_file', 'edit_file', 'list_dir'].includes(t.name)) return shortPath(a.path);
  return `<span class="dir">${esc(toolArgs(t))}</span>`;
}

function itemHTML(it) {
  const d = `data-item="${esc(it.id)}"`;
  if (it.kind === 'user') return `<div class="msg user" ${d}>${(it.images || []).filter((u) => /^data:image\/(png|jpeg|gif|webp);base64,[\w+/=]+$/.test(u)).map((u) => `<img class="thumb" src="${u}" alt="">`).join('')}${esc(it.text)}</div>`;
  if (it.kind === 'assistant') return `<div class="msg assistant ${it.streaming ? 'streaming' : ''}" ${d}>${md(it.text)}</div>`;
  if (it.kind === 'error') return `<div class="msg error" ${d}>⚠ ${esc(it.text)}</div>`;
  if (it.kind === 'info') return `<div class="msg info" ${d}>${it.html ? it.text : esc(it.text)}</div>`;
  if (it.kind === 'thinking') return it.done ? '' : `<div class="msg thinking" ${d}><span class="spin"></span>${esc(it.text)}</div>`;
  if (it.kind === 'tool') {
    const [icon, verb] = toolUi(it.name);
    let body = '';
    if (it.name === 'write_file') body = `<pre>${esc((it.args?.content || '').slice(0, 4000))}</pre>`;
    else if (it.name === 'edit_file') body = `<pre class="diffpre"><span class="del">${esc(it.args?.old_text)}</span>\n<span class="add">${esc(it.args?.new_text)}</span></pre>`;
    if (it.output) body += `<pre>${esc(it.output)}</pre>`;
    const approve = it.state === 'awaiting_approval' ? `<div class="approve-bar"><span>Permitir?</span><button class="small primary" data-approve="${esc(it.callId)}">Aprovar</button><button class="small" data-always="${esc(it.callId)}" title="Aprova e muda este agente para Autônomo">Sempre</button><button class="small" data-reject="${esc(it.callId)}">Rejeitar</button></div>` : '';
    const mark = { running: '<span class="spin"></span>', done: '', error: '<span class="bad">erro</span>', rejected: '<span class="bad">rejeitado</span>', awaiting_approval: '<span class="wait">aguardando</span>' }[it.state] || '';
    return `<details class="tool ${esc(it.state)}" ${d} data-name="${esc(it.name)}" ${it.state === 'awaiting_approval' ? 'open' : ''}><summary><span class="ti">${icon}</span><span class="tv">${esc(verb)}</span><span class="tt">${toolTarget(it)}</span>${mark}</summary>${approve}${body ? `<div class="tbody">${body}</div>` : ''}</details>`;
  }
  return '';
}

// Ações seguidas ficam num bloco recolhido: "Editou 17 arquivos, executou 1 comando".
function groupSummary(g) {
  const rows = [...g.querySelectorAll(':scope > .gbody > .tool')];
  const counts = {};
  for (const r of rows) { const n = toolUi(r.dataset.name)[2]; counts[n] = (counts[n] || 0) + 1; }
  const parts = Object.entries(counts).map(([verb, n]) => `${verb}${n > 1 ? ` ×${n}` : ''}`);
  const running = rows.find((r) => r.classList.contains('running'));
  const waiting = rows.some((r) => r.classList.contains('awaiting_approval'));
  const bad = rows.filter((r) => r.classList.contains('error') || r.classList.contains('rejected')).length;
  const head = g.querySelector(':scope > summary');
  const last = running || rows[rows.length - 1];
  head.innerHTML = `<span class="gicon">${running ? '<span class="spin"></span>' : waiting ? '⏸' : '✓'}</span><span class="gtext">${rows.length} ${rows.length === 1 ? 'ação' : 'ações'} · ${esc(parts.join(' · '))}</span>${bad ? `<span class="bad">${bad} com erro</span>` : ''}${waiting ? '<span class="wait">aguardando você</span>' : ''}`;
  head.title = last ? `${toolUi(last.dataset.name)[1]} ${last.querySelector('.tt')?.textContent || ''}` : '';
  if (waiting) g.open = true;
}
function appendNode(tl, node) {
  if (node.classList.contains('tool')) {
    let g = tl.lastElementChild;
    if (!g || !g.classList.contains('tgroup')) {
      g = document.createElement('details');
      g.className = 'tgroup';
      g.innerHTML = '<summary></summary><div class="gbody"></div>';
      tl.appendChild(g);
    }
    g.querySelector('.gbody').appendChild(node);
    groupSummary(g);
  } else tl.appendChild(node);
}
const toNode = (html) => { const t = document.createElement('div'); t.innerHTML = html; return t.firstElementChild; };
function renderTimeline(tl, items) {
  tl.innerHTML = '';
  for (const it of items) { const h = itemHTML(it); if (h) appendNode(tl, toNode(h)); }
}

function headHTML(a) {
  const b = busy(a);
  const restricted = a.effectiveApproval && a.effectiveApproval !== a.approval;
  return `<span class="title" title="${esc(a.title)}">${esc(a.title)}</span>${statusTag(a.status)}
    <select class="approval-select" data-approval title="${restricted ? 'Pasta não confiável: comandos ainda pedem aprovação até você confiar nela' : 'Modo de aprovação deste agente'}">${Object.entries(APPROVAL).map(([k, v]) => `<option value="${k}" ${a.approval === k ? 'selected' : ''}>${v}${k === a.approval && restricted ? ' (restrito)' : ''}</option>`).join('')}</select>
    ${b ? `<button class="icon danger" data-stop title="Parar">■</button>` : `<button class="icon" data-fork title="Duplicar sessão">⎘</button>`}
    <button class="icon" data-delete title="Excluir agente">🗑</button>`;
}

function renderDetail(el, a, full) {
  if (!a) { el.dataset.agent = ''; el.innerHTML = '<div class="placeholder">Selecione um agente ou crie um novo.<br><span class="muted">Agentes planejam, editam arquivos, rodam comandos e verificam o próprio trabalho.</span></div>'; return; }
  if (el.dataset.agent !== a.id || !$('.timeline', el)) {
    el.dataset.agent = a.id;
    el.innerHTML = `<div class="detail-head"></div><div class="timeline"></div>
      <div class="composer-wrap">
        <div class="attach-row hidden"></div>
        <form class="composer"><div class="slash hidden"></div><textarea rows="2" aria-label="Mensagem para o agente"></textarea>
          <div class="composer-bar"><label class="clip" title="Anexar imagem (ou cole/arraste)">📎<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden></label><span class="model-line"></span><button class="send primary" title="Enviar (Enter)">↑</button></div>
        </form>
      </div>`;
    const tl = $('.timeline', el);
    renderTimeline(tl, full?.timeline || []);
    requestAnimationFrame(() => { tl.scrollTop = tl.scrollHeight; });
  }
  $('.detail-head', el).innerHTML = headHTML(a);
  const ta = $('textarea', el), btn = $('.composer .send', el), b = busy(a);
  ta.disabled = b; btn.disabled = b;
  ta.placeholder = b ? 'Aguarde o agente terminar… (ou ■ Parar)' : 'Responder ou pedir mais…  ( / para comandos)';
  $('.model-line', el).innerHTML = `${esc(providerLabel(a))}`;
  $('.model-line', el).title = 'Use /model para trocar';
}

function upsertItem(agentId, item) {
  for (const el of PANES()) {
    if (el.dataset.agent !== agentId) continue;
    const tl = $('.timeline', el);
    if (!tl) continue;
    const atBottom = tl.scrollHeight - tl.scrollTop - tl.clientHeight < 80;
    const html = itemHTML(item);
    const existing = tl.querySelector(`[data-item="${CSS.escape(item.id)}"]`);
    const group = existing?.closest('.tgroup');
    if (existing) {
      if (!html) existing.remove();
      else {
        const node = toNode(html);
        if (existing.tagName === 'DETAILS' && existing.open) node.open = true;
        existing.replaceWith(node);
      }
      if (group) { if (!group.querySelector('.tool')) group.remove(); else groupSummary(group); }
    } else if (html) appendNode(tl, toNode(html));
    if (atBottom) tl.scrollTop = tl.scrollHeight;
  }
}
function localInfo(text, html = false) {
  const f = S.full[S.selected];
  if (!f) return;
  const item = { id: `local_${Date.now()}`, kind: 'info', text, html };
  f.timeline.push(item);
  upsertItem(S.selected, item);
}

/* ---------- Comandos com barra ---------- */
const SLASH = [
  { cmd: '/model', hint: 'provedor[:modelo] — trocar o modelo (/model openrouter abre o catálogo)' },
  { cmd: '/auto', hint: 'deixar este agente no modo Autônomo' },
  { cmd: '/fork', hint: 'duplicar a sessão para tentar outro caminho' },
  { cmd: '/usage', hint: 'tokens e custo deste agente e do projeto' },
  { cmd: '/repomap', hint: 'ver o mapa do repositório' },
  { cmd: '/provider', hint: 'configurar provedores e chaves' },
  { cmd: '/procs', hint: 'processos em segundo plano' },
  { cmd: '/trust', hint: 'confiar nesta pasta (libera o modo Autônomo)' },
  { cmd: '/buddy', hint: '[nome|mudo|som|trocar] — o mascote' },
  { cmd: '/onboard-github', hint: 'sobre o GitHub Models' },
  { cmd: '/help', hint: 'listar comandos' },
];
async function runSlash(text) {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(' ');
  const a = S.agents[S.selected];
  switch (cmd) {
    case '/help':
      return localInfo(SLASH.map((s) => `<code>${s.cmd}</code> ${esc(s.hint)}`).join('<br>'), true);
    case '/model': {
      const orId = Object.keys(S.config.providers).find((k) => k === (arg || '').replace(/:$/, '') && isOR(S.config.providers[k]));
      if (orId) return openModelBrowser({ providerId: orId, current: a.model, onPick: (m) => api(`/api/agents/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { providerId: orId, model: m.id } }).catch((e) => toast(e.message, 'error')) });
      if (!arg) return localInfo(`Atual: ${providerLabel(a)}<br>Disponíveis: ${Object.entries(S.config.providers).map(([id, p]) => `<code>${esc(id)}</code>`).join(' ')}<br>Ex.: <code>/model ollama:qwen2.5-coder:14b</code>`, true);
      const i = arg.indexOf(':');
      const [providerId, model] = i > 0 && S.config.providers[arg.slice(0, i)] ? [arg.slice(0, i), arg.slice(i + 1)] : S.config.providers[arg] ? [arg, ''] : [a.providerId, arg];
      await api(`/api/agents/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { providerId, model } });
      return;
    }
    case '/auto':
      await api(`/api/agents/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { approval: 'auto' } });
      return;
    case '/fork': {
      const n = await api(`/api/agents/${encodeURIComponent(a.id)}/fork`, { method: 'POST' });
      S.agents[n.id] = n; S.full[n.id] = n; await selectAgent(n.id);
      return toast('Sessão duplicada.', 'ok');
    }
    case '/usage': {
      const all = sortedAgents();
      const sum = all.reduce((t, x) => ({ i: t.i + x.usage.input, o: t.o + x.usage.output, c: t.c + x.usage.cost }), { i: 0, o: 0, c: 0 });
      return localInfo(`Este agente: ${a.usage.input.toLocaleString('pt-BR')} tok entrada · ${a.usage.output.toLocaleString('pt-BR')} saída · US$ ${a.usage.cost.toFixed(4)}<br>Projeto (${all.length} agentes): ${sum.i.toLocaleString('pt-BR')} · ${sum.o.toLocaleString('pt-BR')} · US$ ${sum.c.toFixed(4)}<br><span class="muted">Custo em US$ só conta provedores com preço preenchido nas Configurações.</span>`, true);
    }
    case '/repomap': {
      const { text: map } = await api('/api/repomap');
      return showInfo('Mapa do repositório', map);
    }
    case '/provider':
      return openSettings(arg && S.config.providers[arg] ? `p:${arg}` : 'add');
    case '/procs':
      setView('manager');
      return localInfo(S.procs.length ? S.procs.map((p) => `${esc(p.id)} · ${esc(p.status)} · ${esc(p.name)}${p.port ? ` · porta ${Number(p.port)}` : ''}`).join('<br>') : 'Nenhum processo em segundo plano.', true);
    case '/trust':
      return setTrust(true);
    case '/buddy':
      return window.LGBuddy ? window.LGBuddy.command(arg) : toast('Mascote indisponível.', 'error');
    case '/onboard-github':
      return localInfo('O GitHub Models foi <b>descontinuado</b> pelo GitHub em 30/07/2026 (playground, catálogo e API de inferência). O próprio GitHub indica o <b>Azure AI Foundry</b> como substituto — ele está em <code>/provider</code> → Adicionar provedor → Azure AI Foundry.', true);
    default:
      toast(`Comando desconhecido: ${cmd}. Use /help.`, 'error');
  }
}
function updateSlashMenu(form) {
  const ta = $('textarea', form), menu = $('.slash', form);
  const v = ta.value;
  if (!v.startsWith('/') || v.includes(' ') || v.includes('\n')) { menu.classList.add('hidden'); return; }
  const hits = SLASH.filter((s) => s.cmd.startsWith(v));
  if (!hits.length) { menu.classList.add('hidden'); return; }
  menu.innerHTML = hits.map((s, i) => `<div class="slash-item ${i === 0 ? 'sel' : ''}" data-cmd="${s.cmd}"><code>${s.cmd}</code> <span class="muted">${esc(s.hint)}</span></div>`).join('');
  menu.classList.remove('hidden');
}

// Eventos delegados nas duas áreas de detalhe
for (const el of PANES()) {
  el.addEventListener('click', async (e) => {
    const id = S.selected;
    const t = e.target;
    try {
      if (t.dataset.approve) await api(`/api/agents/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { callId: t.dataset.approve, approved: true } });
      else if (t.dataset.reject) await api(`/api/agents/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { callId: t.dataset.reject, approved: false } });
      else if (t.dataset.always) await api(`/api/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: { approval: 'auto' } });
      else if ('stop' in t.dataset) await api(`/api/agents/${encodeURIComponent(id)}/stop`, { method: 'POST' });
      else if ('fork' in t.dataset) await runSlash('/fork');
      else if ('delete' in t.dataset) {
        if (ED().confirmDelete === false || confirm('Excluir este agente? (as alterações nos arquivos permanecem)')) await api(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } else if (t.closest('.slash-item')) {
        const form = t.closest('form'); $('textarea', form).value = t.closest('.slash-item').dataset.cmd + ' '; $('textarea', form).focus(); updateSlashMenu(form);
      }
    } catch (err) { toast(err.message, 'error'); }
  });
  el.addEventListener('change', async (e) => {
    if ('approval' in e.target.dataset) {
      try { await api(`/api/agents/${encodeURIComponent(S.selected)}`, { method: 'PATCH', body: { approval: e.target.value } }); }
      catch (err) { toast(err.message, 'error'); }
    }
  });
  el.addEventListener('input', (e) => { if (e.target.tagName === 'TEXTAREA') updateSlashMenu(e.target.form); });
  el.addEventListener('change', (e) => { if (e.target.type === 'file') { addImages(el, e.target.files); e.target.value = ''; } });
  el.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); addImages(el, files); } });
  el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.type.startsWith('image/'))) e.preventDefault(); });
  el.addEventListener('drop', (e) => { const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); addImages(el, files); } });
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = $('textarea', e.target);
    const text = ta.value.trim();
    if (!text && !(ATT.get(el) || []).length) return;
    ta.value = '';
    updateSlashMenu(e.target);
    try {
      if (text.startsWith('/') && SLASH.some((s) => text.split(/\s/)[0] === s.cmd)) await runSlash(text);
      else {
        const images = ATT.get(el) || [];
        await api(`/api/agents/${encodeURIComponent(S.selected)}/messages`, { method: 'POST', body: { text, images } });
        ATT.set(el, []); renderAttach(el);
      }
    } catch (err) { toast(err.message, 'error'); ta.value = text; }
  });
  el.addEventListener('keydown', (e) => {
    if (e.target.tagName !== 'TEXTAREA') return;
    const menu = $('.slash', e.target.form);
    if (e.key === 'Tab' && menu && !menu.classList.contains('hidden')) {
      e.preventDefault(); e.target.value = $('.slash-item.sel', menu).dataset.cmd + ' '; updateSlashMenu(e.target.form);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); }
  });
}
$('#panel-agent').onchange = (e) => selectAgent(e.target.value);
$('#inbox').addEventListener('click', (e) => { const it = e.target.closest('.inbox-item'); if (it) selectAgent(it.dataset.id); });
$('#changes').addEventListener('click', async (e) => {
  if (e.target.id === 'btn-undo') {
    if (!confirm('Restaurar todos os arquivos alterados por este agente?')) return;
    try {
      const r = await api(`/api/agents/${encodeURIComponent(S.selected)}/undo`, { method: 'POST', body: {} });
      if (r.conflicts?.length) {
        if (confirm(`${r.conflicts.length} arquivo(s) foram alterados depois por você ou por outro agente:\n\n${r.conflicts.join('\n')}\n\nDesfazer mesmo assim (perde essas alterações)?`)) await api(`/api/agents/${encodeURIComponent(S.selected)}/undo`, { method: 'POST', body: { force: true } });
      } else toast('Alterações desfeitas.', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  }
  if (e.target.dataset.diff) showDiff(e.target.dataset.diff).catch((err) => toast(err.message, 'error'));
  if (e.target.dataset.open) { revealInTree(e.target.dataset.open); openFile(e.target.dataset.open).catch((err) => toast(err.message, 'error')); }
});

/* ---------- Imagens anexadas ---------- */
const ATT = new Map(); // painel -> [{ mediaType, data, name }]
function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return reject(new Error(`Formato não suportado: ${file.type || file.name}`));
    if (file.size > 5_000_000) return reject(new Error(`${file.name}: imagem maior que 5 MB.`));
    const r = new FileReader();
    r.onload = () => resolve({ mediaType: file.type, data: String(r.result).split(',')[1], name: file.name });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
async function addImages(pane, files) {
  const list = ATT.get(pane) || [];
  for (const f of files) {
    if (list.length >= 6) { toast('Máximo de 6 imagens por mensagem.', 'error'); break; }
    try { list.push(await readImage(f)); } catch (e) { toast(e.message, 'error'); }
  }
  ATT.set(pane, list); renderAttach(pane);
}
function renderAttach(pane) {
  const row = $('.attach-row', pane);
  if (!row) return;
  const list = ATT.get(pane) || [];
  row.classList.toggle('hidden', !list.length);
  row.innerHTML = list.map((i, n) => `<span class="att"><img src="data:${esc(i.mediaType)};base64,${i.data}" alt=""><button type="button" class="x" data-unattach="${n}" title="Remover">×</button></span>`).join('');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-unattach]');
  if (!b) return;
  const pane = b.closest('.detail');
  const list = ATT.get(pane) || [];
  list.splice(Number(b.dataset.unattach), 1); renderAttach(pane);
});

/* ---------- Processos em segundo plano ---------- */
S.procs = [];
function renderProcs() {
  const el = $('#procs');
  if (!el) return;
  el.innerHTML = S.procs.length ? S.procs.map((p) => `<div class="proc"><span class="pdot ${p.status === 'running' ? 'on' : ''}"></span><span class="pname" title="${esc(p.command)}">${esc(p.name)}${p.port ? ` <a href="http://localhost:${Number(p.port)}" target="_blank" rel="noopener">:${Number(p.port)}</a>` : ''}</span><button class="small" data-plog="${esc(p.id)}">log</button>${p.status === 'running' ? `<button class="small danger" data-pstop="${esc(p.id)}">■</button>` : `<span class="muted small">${esc(p.status)}</span>`}</div>`).join('') : '<span class="muted">Nenhum processo. Agentes iniciam servidores aqui com start_background.</span>';
}
document.addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.pstop) await api(`/api/procs/${encodeURIComponent(t.dataset.pstop)}/stop`, { method: 'POST' });
    if (t.dataset.plog) { const r = await api(`/api/procs/${encodeURIComponent(t.dataset.plog)}/log`); showInfo(`Log do processo ${t.dataset.plog}`, r.log || '(vazio)'); }
  } catch (err) { toast(err.message, 'error'); }
});

/* ---------- Confiança na pasta ---------- */
S.trusted = true;
function renderTrust() {
  let bar = $('#trustbar');
  if (S.trusted) { bar?.remove(); document.body.classList.remove('untrusted'); return; }
  document.body.classList.add('untrusted');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'trustbar';
    bar.innerHTML = `<span>🛡 <b>Modo restrito.</b> Você confia nesta pasta? Sem confiança, os agentes pedem aprovação antes de comandos (mesmo no modo Autônomo) e skills que vieram dentro do projeto são ignoradas. Pastas baixadas da internet podem trazer instruções maliciosas.</span><button class="small primary" id="trust-yes">Confiar nesta pasta</button><button class="small" id="trust-no">Agora não</button>`;
    document.querySelector('.topbar').after(bar);
    requestAnimationFrame(() => document.documentElement.style.setProperty('--trustbar-h', `${bar.offsetHeight}px`));
    $('#trust-yes').onclick = () => setTrust(true);
    $('#trust-no').onclick = () => { bar.remove(); document.body.classList.remove('untrusted'); };
  }
}
async function setTrust(v) {
  try { S.trusted = (await api('/api/trust', { method: 'POST', body: { trusted: v } })).trusted; renderTrust(); toast(v ? 'Pasta marcada como confiável.' : 'Pasta em modo restrito.', 'ok'); }
  catch (e) { toast(e.message, 'error'); }
}

/* ---------- Catálogo de modelos do OpenRouter ---------- */
const MB = { models: [], price: 'all', providerId: 'openrouter', provider: null, onPick: null, loading: false, error: '' };
const isOR = (p) => /openrouter\.ai/i.test(p?.baseUrl || '');
const fmtPrice = (v) => (v === null || v === undefined ? '?' : String(Number(v.toFixed(v < 0.01 ? 4 : v < 1 ? 3 : 2))).replace('.', ','));
const fmtCtx = (n) => (!n ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`);

async function openModelBrowser({ providerId = 'openrouter', provider, current, onPick }) {
  Object.assign(MB, { providerId, provider: provider || S.config.providers[providerId], onPick, current });
  $('#mb-q').value = '';
  $('#dlg-models').showModal();
  $('#mb-q').focus();
  await loadModels(false);
}
async function loadModels(refresh) {
  MB.loading = true; MB.error = ''; renderModels();
  const r = await api('/api/providers/openrouter-models', { method: 'POST', body: { id: MB.providerId, provider: MB.provider, refresh } }).catch((e) => ({ ok: false, error: e.message }));
  MB.loading = false;
  if (r.ok) MB.models = r.models; else MB.error = r.error;
  renderModels();
}
function filteredModels() {
  const words = $('#mb-q').value.toLowerCase().split(/\s+/).filter(Boolean);
  const tools = $('#mb-tools').checked, vision = $('#mb-vision').checked;
  let list = MB.models.filter((m) => {
    if (MB.price === 'free' && !m.free) return false;
    if (MB.price === 'paid' && (m.free || m.variable)) return false;
    if (tools && !m.tools) return false;
    if (vision && !m.vision) return false;
    const hay = `${m.name} ${m.id} ${m.author}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const sort = $('#mb-sort').value;
  const cost = (m) => (m.variable ? 1e9 : (m.priceIn || 0) + (m.priceOut || 0) * 3);
  list.sort((a, b) => sort === 'new' ? b.created - a.created : sort === 'ctx' ? (b.context || 0) - (a.context || 0) : sort === 'name' ? a.name.localeCompare(b.name) : cost(a) - cost(b) || (b.context || 0) - (a.context || 0));
  return list;
}
function renderModels() {
  const el = $('#mb-list');
  if (MB.loading) { el.innerHTML = '<div class="placeholder"><span class="spin"></span> Carregando o catálogo do OpenRouter…</div>'; $('#mb-count').textContent = ''; return; }
  if (MB.error) { el.innerHTML = `<div class="placeholder"><span class="err">${esc(MB.error)}</span><br><button class="small" id="mb-retry">Tentar de novo</button></div>`; return; }
  const list = filteredModels();
  const free = MB.models.filter((m) => m.free).length;
  $('#mb-count').textContent = `${list.length} de ${MB.models.length} modelos · ${free} grátis`;
  el.innerHTML = list.slice(0, 400).map((m) => `<button class="mb-row ${m.id === MB.current ? 'cur' : ''}" data-mid="${esc(m.id)}">
      <span class="mb-main"><b>${esc(m.name)}</b><code>${esc(m.id)}</code>${m.description ? `<small>${esc(m.description)}</small>` : ''}</span>
      <span class="mb-tags">${m.tools ? '<span class="tag" title="Aceita ferramentas">🛠</span>' : '<span class="tag off" title="Sem ferramentas: não consegue editar arquivos">sem 🛠</span>'}${m.vision ? '<span class="tag" title="Aceita imagens">🖼</span>' : ''}${m.reasoning ? '<span class="tag" title="Raciocínio">🧠</span>' : ''}${m.context ? `<span class="tag ctx" title="Contexto">${fmtCtx(m.context)}</span>` : ''}</span>
      <span class="mb-price">${m.free ? '<span class="free">GRÁTIS</span>' : m.variable ? '<span class="muted">variável</span>' : `<span>US$ ${fmtPrice(m.priceIn)}</span><span class="muted"> / ${fmtPrice(m.priceOut)}</span>`}</span>
    </button>`).join('') || '<div class="placeholder">Nenhum modelo com esses filtros.</div>';
}
$('#mb-q').addEventListener('input', renderModels);
for (const id of ['#mb-tools', '#mb-vision', '#mb-sort']) $(id).addEventListener('change', renderModels);
$('#mb-price').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; MB.price = b.dataset.v; $$('#mb-price button').forEach((x) => x.classList.toggle('on', x === b)); renderModels(); });
$('#mb-refresh').onclick = () => loadModels(true);
$('#mb-close').onclick = () => $('#dlg-models').close();
$('#mb-list').addEventListener('click', (e) => {
  if (e.target.id === 'mb-retry') return loadModels(true);
  const row = e.target.closest('[data-mid]');
  if (!row) return;
  const m = MB.models.find((x) => x.id === row.dataset.mid);
  if (!m.tools && !confirm(`${m.name} não aceita ferramentas: o agente não vai conseguir ler/editar arquivos nem rodar comandos. Usar mesmo assim?`)) return;
  $('#dlg-models').close();
  MB.onPick?.(m);
});

/* ---------- Diff e informações ---------- */
let diffEditor = null;
async function showDiff(path) {
  const d = await api(`/api/agents/${encodeURIComponent(S.selected)}/diff?path=${encodeURIComponent(path)}`);
  S.monaco = S.monaco || await monacoReady;
  $('#diff-title').textContent = `${path} — antes × depois`;
  const host = $('#diff-editor');
  host.innerHTML = '';
  $('#dlg-diff').showModal();
  if (S.monaco) {
    diffEditor = S.monaco.editor.createDiffEditor(host, { theme: 'lastgravity', automaticLayout: true, readOnly: true, fontSize: Number(ED().fontSize) || 13 });
    diffEditor.setModel({ original: S.monaco.editor.createModel(d.original, langOf(path)), modified: S.monaco.editor.createModel(d.current, langOf(path)) });
  } else {
    host.innerHTML = `<div class="row" style="height:100%"><pre style="overflow:auto">${esc(d.original)}</pre><pre style="overflow:auto">${esc(d.current)}</pre></div>`;
  }
}
$('#dlg-diff').addEventListener('close', () => {
  if (diffEditor) { const m = diffEditor.getModel(); diffEditor.dispose(); m?.original.dispose(); m?.modified.dispose(); diffEditor = null; }
});
$('#diff-close').onclick = () => $('#dlg-diff').close();
function showInfo(title, text) { $('#info-title').textContent = title; $('#info-body').textContent = text; $('#dlg-info').showModal(); }
$('#info-close').onclick = () => $('#dlg-info').close();

/* ---------- Novo agente ---------- */
const needsKey = (p) => p.type !== 'mock' && p.type !== 'ollama' && p.variant !== 'vertex' && !isLocal(p.baseUrl);
const ready = (p) => !needsKey(p) || !!p.apiKey;
function providerOptions(sel) {
  return Object.entries(S.config.providers).map(([id, p]) => `<option value="${esc(id)}" ${id === sel ? 'selected' : ''}>${esc(p.label)}${ready(p) ? '' : ' — sem chave'}</option>`).join('');
}
function updateNewWarn() {
  const p = S.config.providers[$('#new-provider').value];
  $('#new-browse').classList.toggle('hidden', !isOR(p));
  const w = $('#new-warn');
  w.classList.toggle('hidden', !p || ready(p));
  w.innerHTML = p && !ready(p) ? `Este provedor ainda não tem chave. <a href="#" id="go-key">Configurar agora</a>` : '';
  const fav = (S.config.favoriteModels || []).filter((f) => f.providerId === $('#new-provider').value);
  $('#new-models').innerHTML = fav.map((f) => `<option value="${esc(f.model)}">${esc(f.label || '')}</option>`).join('');
}
$('#btn-new').onclick = () => {
  const f = $('#form-new');
  f.reset();
  $('#new-provider').innerHTML = providerOptions(S.config.defaultProvider);
  $('#new-model').value = S.config.providers[S.config.defaultProvider]?.model || '';
  f.approval.value = S.config.approval;
  updateNewWarn();
  $('#dlg-new').showModal();
  f.prompt.focus();
};
$('#new-browse').onclick = () => {
  const id = $('#new-provider').value;
  openModelBrowser({ providerId: id, current: $('#new-model').value, onPick: (m) => { $('#new-model').value = m.id; } });
};
$('#new-provider').onchange = (e) => { $('#new-model').value = S.config.providers[e.target.value]?.model || ''; updateNewWarn(); };
$('#new-warn').addEventListener('click', (e) => { if (e.target.id === 'go-key') { e.preventDefault(); const id = $('#new-provider').value; $('#dlg-new').close(); openSettings(`p:${id}`); } });
$('#form-new').prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#form-new button[value=ok]').click(); } });
$('#dlg-new').addEventListener('close', async () => {
  if ($('#dlg-new').returnValue !== 'ok') return;
  const f = $('#form-new');
  try {
    const a = await api('/api/agents', { method: 'POST', body: { prompt: f.prompt.value, providerId: f.providerId.value, model: f.model.value.trim() || undefined, approval: f.approval.value } });
    S.agents[a.id] = a; S.full[a.id] = a;
    await selectAgent(a.id);
  } catch (err) { toast(err.message, 'error'); }
});

/* ---------- Configurações com abas ---------- */
const KEY_LINKS = {
  anthropic: 'https://console.anthropic.com/settings/keys', gemini: 'https://aistudio.google.com/apikey',
  openai: 'https://platform.openai.com/api-keys', openrouter: 'https://openrouter.ai/keys', ollama: 'https://ollama.com/download',
};
const PRESETS = [
  { slug: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { slug: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  { slug: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  { slug: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai' },
  { slug: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', keyUrl: '' },
  { slug: 'azure', label: 'Azure AI Foundry / Azure OpenAI', baseUrl: 'https://SEU-RECURSO.openai.azure.com/openai/v1', keyUrl: 'https://ai.azure.com', note: 'Troque SEU-RECURSO pelo nome do seu recurso. No campo modelo, use o nome da implantação (deployment).' },
  { slug: 'bedrock', label: 'Claude no Amazon Bedrock', type: 'anthropic', variant: 'bedrock', baseUrl: '', region: 'us-east-1', keyUrl: 'https://console.aws.amazon.com/bedrock/home#/api-keys', note: 'Use uma chave de API do Bedrock. O modelo é o ID do perfil de inferência (ex.: global.anthropic.claude-…). Experimental.' },
  { slug: 'vertex', label: 'Claude no Google Vertex AI', type: 'anthropic', variant: 'vertex', baseUrl: '', region: 'global', project: '', keyUrl: 'https://console.cloud.google.com/vertex-ai/model-garden', note: 'Precisa do gcloud instalado e "gcloud auth login" (ou cole um token de acesso). O modelo é o nome no Model Garden.' },
  { slug: 'anthropic-compat', label: 'Proxy compatível com a API da Anthropic', type: 'anthropic', baseUrl: '', keyUrl: '' },
  { slug: 'custom', label: 'Personalizado (compatível com OpenAI)', baseUrl: '', keyUrl: '' },
];
const EXT_TABS = [];
const SET = { draft: null, tab: 'geral', dirty: false, tests: {}, models: {} };

window.LG = {
  api, toast, esc, openModelBrowser,
  registerSettingsTab(tab) { EXT_TABS.push(tab); EXT_TABS.sort((a, b) => (a.order ?? 50) - (b.order ?? 50)); if ($('#dlg-settings').open) renderSettings(); },
  getConfig: () => S.config,
};

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function openSettings(tab = 'geral') {
  SET.draft = clone(S.config);
  SET.draft.deleted = [];
  SET.tab = tab; SET.dirty = false; SET.tests = {}; SET.models = {};
  renderSettings();
  $('#dlg-settings').showModal();
}
$('#btn-settings').onclick = () => openSettings();

function settingsTabs() {
  const D = SET.draft;
  const core = [{ id: 'geral', label: 'Geral', icon: '⚙', order: 10 }, { id: 'editor', label: 'Editor', icon: '📝', order: 20 }];
  const all = [...core, ...EXT_TABS.map((t) => ({ ...t, ext: true }))].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  const prov = Object.entries(D.providers).filter(([, p]) => p.type !== 'mock').map(([id, p]) => ({ id: `p:${id}`, pid: id, label: p.label, ready: ready(p), def: D.defaultProvider === id }));
  return { all, prov };
}

function renderSettings() {
  const { all, prov } = settingsTabs();
  if (!all.some((t) => t.id === SET.tab) && !prov.some((t) => t.id === SET.tab) && SET.tab !== 'add') SET.tab = 'geral';
  $('#set-tabs').innerHTML = `
    ${all.map((t) => `<button class="set-tab ${SET.tab === t.id ? 'active' : ''}" data-tab="${esc(t.id)}"><span class="ti">${t.icon || '•'}</span><span class="lbl">${esc(t.label)}</span></button>`).join('')}
    <div class="set-group">CHAVES DE API</div>
    ${prov.map((t) => `<button class="set-tab ${SET.tab === t.id ? 'active' : ''}" data-tab="${esc(t.id)}"><span class="dot ${t.ready ? 'on' : ''}" title="${t.ready ? 'Configurado' : 'Sem chave'}"></span><span class="lbl">${esc(t.label)}</span>${t.def ? ' <span class="star" title="Padrão">★</span>' : ''}</button>`).join('')}
    <button class="set-tab add ${SET.tab === 'add' ? 'active' : ''}" data-tab="add"><span class="ti">＋</span>Adicionar provedor</button>`;
  const body = $('#set-body');
  body.innerHTML = '';
  if (SET.tab === 'geral') body.innerHTML = generalTab();
  else if (SET.tab === 'editor') body.innerHTML = editorTab();
  else if (SET.tab === 'add') body.innerHTML = addTab();
  else if (SET.tab.startsWith('p:')) body.innerHTML = providerTab(SET.tab.slice(2));
  else {
    const ext = EXT_TABS.find((t) => t.id === SET.tab);
    try { ext?.render(body, SET.draft, { api, toast, esc, rerender: renderSettings, markDirty: () => { SET.dirty = true; }, providers: () => Object.entries(SET.draft.providers).map(([id, p]) => ({ id, ...p })) }); }
    catch (e) { body.innerHTML = `<p class="warn">Erro ao abrir esta aba: ${esc(e.message)}</p>`; }
  }
}

const field = (label, path, input, help = '') => `<label class="fld"><span>${label}</span>${input}${help ? `<small>${help}</small>` : ''}</label>`;
const inp = (path, type = 'text', extra = '') => { const v = getPath(SET.draft, path); return `<input data-k="${path}" type="${type}" value="${esc(v ?? '')}" ${extra}>`; };
const chk = (path, label) => `<label class="chk"><input type="checkbox" data-k="${path}" ${getPath(SET.draft, path) ? 'checked' : ''}> ${label}</label>`;
const sel = (path, opts) => { const v = getPath(SET.draft, path); return `<select data-k="${path}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(v) === String(k) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`; };

function generalTab() {
  const D = SET.draft;
  const card = (k, title, desc, warn) => `<label class="radio-card ${D.approval === k ? 'sel' : ''}"><input type="radio" name="approval" data-k="approval" value="${k}" ${D.approval === k ? 'checked' : ''}><b>${title}</b><span>${desc}</span>${warn ? `<em>${warn}</em>` : ''}</label>`;
  return `<h3>Geral</h3>
    <h4>Aprovação padrão dos agentes</h4>
    <p class="muted">Vale para novos agentes. Para um agente que já está rodando, troque no seletor do cabeçalho dele ou digite <code>/auto</code>.</p>
    <div class="radio-cards">
      ${card('auto', '⚡ Autônomo', 'O agente edita arquivos e roda comandos sem perguntar.', 'Cuidado: comandos rodam direto no seu computador. Você ainda pode desfazer as edições de arquivo.')}
      ${card('ask-commands', '🛡 Pedir antes de comandos', 'Edita arquivos sozinho (com desfazer), mas pergunta antes de rodar comandos.')}
      ${card('ask-all', '🔒 Pedir antes de tudo', 'Pergunta antes de qualquer alteração ou comando.')}
    </div>
    <h4>Agentes</h4>
    <div class="row">
      ${field('Máximo de passos por tarefa', 'maxSteps', inp('maxSteps', 'number', 'min="1" max="500"'), 'Depois disso o agente pausa e você pode dizer "continue".')}
      ${field('Provedor padrão', 'defaultProvider', sel('defaultProvider', Object.entries(D.providers).map(([id, p]) => [id, p.label])))}
    </div>
    ${chk('repoMapInPrompt', 'Enviar o mapa do repositório no início de cada tarefa (agente se orienta mais rápido)')}
    <h4>Busca na web</h4>
    <div class="row">
      ${field('Serviço de busca', 'webSearch.provider', sel('webSearch.provider', [['duckduckgo', 'DuckDuckGo (grátis, sem chave)'], ['brave', 'Brave Search (chave)'], ['tavily', 'Tavily (chave)']]))}
      ${field('Chave do serviço de busca', 'webSearch.apiKey', inp('webSearch.apiKey', 'password', 'placeholder="só para Brave ou Tavily"'))}
    </div>
    <h4>Esta pasta</h4>
    <p class="muted">${S.trusted ? '✅ Você confia nesta pasta: o modo Autônomo vale por completo e as skills do projeto são carregadas.' : '🛡 Modo restrito: comandos sempre pedem aprovação e skills do projeto são ignoradas.'}</p>
    <p><button class="small ${S.trusted ? '' : 'primary'}" data-act="trust">${S.trusted ? 'Deixar de confiar' : 'Confiar nesta pasta'}</button></p>
    ${chk('notifications', 'Notificações do sistema quando um agente precisar de mim ou terminar (app desktop)')}`;
}

function editorTab() {
  return `<h3>Editor</h3>
    <h4>Aparência</h4>
    <div class="row3">
      ${field('Tamanho da fonte', 'editor.fontSize', inp('editor.fontSize', 'number', 'min="8" max="32"'))}
      ${field('Fonte', 'editor.fontFamily', inp('editor.fontFamily', 'text', 'placeholder="padrão (Menlo, Consolas…)"'))}
      ${field('Números de linha', 'editor.lineNumbers', sel('editor.lineNumbers', [['on', 'Mostrar'], ['relative', 'Relativos'], ['off', 'Ocultar']]))}
      ${field('Quebra de linha', 'editor.wordWrap', sel('editor.wordWrap', [['off', 'Desligada'], ['on', 'Na largura da tela'], ['bounded', 'Limitada']]))}
      ${field('Mostrar espaços', 'editor.renderWhitespace', sel('editor.renderWhitespace', [['none', 'Não'], ['boundary', 'Nas bordas'], ['selection', 'Na seleção'], ['all', 'Todos']]))}
      ${field('Cursor', 'editor.cursorBlinking', sel('editor.cursorBlinking', [['blink', 'Piscando'], ['smooth', 'Suave'], ['phase', 'Fase'], ['solid', 'Fixo']]))}
    </div>
    ${chk('editor.minimap', 'Mostrar minimapa')} ${chk('editor.bracketPairs', 'Colorir pares de colchetes')} ${chk('editor.smoothScrolling', 'Rolagem suave')}
    <h4>Tabulação e salvamento</h4>
    <div class="row3">
      ${field('Tamanho da tabulação', 'editor.tabSize', sel('editor.tabSize', [[2, '2 espaços'], [4, '4 espaços'], [8, '8 espaços']]))}
      ${field('Salvar automaticamente', 'editor.autoSave', sel('editor.autoSave', [['off', 'Desligado'], ['afterDelay', 'Após uma pausa'], ['onFocusChange', 'Ao sair do editor']]))}
      ${field('Pausa (ms)', 'editor.autoSaveDelay', inp('editor.autoSaveDelay', 'number', 'min="200" step="100"'))}
    </div>
    ${chk('editor.insertSpaces', 'Usar espaços em vez de tab')} ${chk('editor.trimTrailingWhitespace', 'Remover espaços no fim das linhas ao salvar')} ${chk('editor.insertFinalNewline', 'Garantir linha em branco no fim do arquivo')}
    <h4>Terminal e agentes</h4>
    <div class="row3">${field('Fonte do terminal', 'editor.terminalFontSize', inp('editor.terminalFontSize', 'number', 'min="8" max="24"'))}</div>
    ${chk('editor.followAgent', 'Seguir o agente: abrir no editor os arquivos que ele altera')}
    ${chk('editor.confirmDelete', 'Confirmar antes de excluir agentes')}`;
}

function providerTab(id) {
  const p = SET.draft.providers[id];
  if (!p) return '<p class="muted">Provedor não encontrado.</p>';
  if (p.type === 'anthropic' && p.promptCache === undefined) p.promptCache = true;
  const custom = id.startsWith('custom_');
  const local = isLocal(p.baseUrl) || p.type === 'ollama';
  const link = p.keyUrl || KEY_LINKS[id];
  const t = SET.tests[id];
  const models = SET.models[id];
  const k = `providers.${id}`;
  return `<div class="prov-head"><h3>${esc(p.label)}</h3>${SET.draft.defaultProvider === id ? '<span class="pill">★ padrão</span>' : `<button class="small" data-act="default" data-id="${esc(id)}">Tornar padrão</button>`}</div>
    ${custom ? field('Nome', `${k}.label`, inp(`${k}.label`)) : ''}
    ${field(local ? 'Chave de API (opcional para servidor local)' : 'Chave de API', `${k}.apiKey`,
      `<div class="keybox">${inp(`${k}.apiKey`, 'password', `autocomplete="off" spellcheck="false" placeholder="${local ? 'não precisa' : 'cole sua chave aqui'}"`)}<button class="small" data-act="eye" title="Mostrar/ocultar">👁</button></div>`,
      link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${id === 'ollama' ? 'Baixar o Ollama ↗' : 'Onde conseguir a chave ↗'}</a>` : '')}
    ${p.note ? `<p class="muted">ℹ ${esc(p.note)}</p>` : ''}
    ${p.variant === 'vertex' ? `<div class="row">${field('ID do projeto Google Cloud', `${k}.project`, inp(`${k}.project`))}${field('Região', `${k}.region`, inp(`${k}.region`, 'text', 'placeholder="global, us-east5, europe-west1…"'))}</div>`
      : p.variant === 'bedrock' ? `<div class="row">${field('Região AWS', `${k}.region`, inp(`${k}.region`, 'text', 'placeholder="us-east-1"'))}${field('URL base (opcional)', `${k}.baseUrl`, inp(`${k}.baseUrl`, 'text', 'placeholder="automática pela região"'))}</div>`
      : field('URL base', `${k}.baseUrl`, inp(`${k}.baseUrl`, 'text', 'spellcheck="false"'))}
    ${p.type === 'ollama' ? field('Tamanho do contexto (num_ctx)', `${k}.numCtx`, inp(`${k}.numCtx`, 'number', 'min="2048" step="1024"'), 'Quanto o modelo "enxerga". 32768 é um bom começo; mais contexto usa mais memória RAM/VRAM.') : ''}
    ${p.type === 'anthropic' ? chk(`${k}.promptCache`, 'Cache de prompt (mais barato em sessões longas)') : ''}
    ${field('Modelo padrão deste provedor', `${k}.model`,
      `<div class="keybox">${inp(`${k}.model`, 'text', `list="dl-${esc(id)}" spellcheck="false"`)}${isOR(p) ? `<button class="small primary" data-act="orbrowse" data-id="${esc(id)}">🔎 Explorar (grátis/pagos)</button>` : ''}<button class="small" data-act="models" data-id="${esc(id)}">Buscar modelos</button></div>
       <datalist id="dl-${esc(id)}">${(models?.list || []).map((m) => `<option value="${esc(m)}">`).join('')}</datalist>`,
      models?.loading ? 'Buscando…' : models?.error ? `<span class="err">${esc(models.error)}</span>` : models?.list ? `${models.list.length} modelos encontrados — clique no campo para escolher.` : 'Confira o nome exato disponível na sua conta.')}
    <div class="row">
      ${field('Preço de entrada (US$ / milhão de tokens)', `${k}.priceIn`, inp(`${k}.priceIn`, 'number', 'step="any" min="0" placeholder="opcional"'))}
      ${field('Preço de saída (US$ / milhão de tokens)', `${k}.priceOut`, inp(`${k}.priceOut`, 'number', 'step="any" min="0" placeholder="opcional"'))}
    </div>
    <div class="test-row">
      <button class="primary" data-act="test" data-id="${esc(id)}">⚡ Testar conexão</button>
      <span class="test-res ${t ? (t.loading ? '' : t.ok ? 'ok' : 'err') : ''}">${t ? (t.loading ? 'Testando…' : t.ok ? `✔ Funcionou em ${(t.ms / 1000).toFixed(1)} s — resposta: “${esc(t.reply)}”` : `✖ ${esc(t.error)}`) : 'Testa a chave, a URL e o modelo sem salvar.'}</span>
    </div>
    ${id === 'ollama' ? '<p class="muted">Dica: instale o Ollama e rode <code>ollama pull qwen2.5-coder:14b</code>. Modelos locais são grátis e funcionam offline.</p>' : ''}
    ${custom ? `<p><button class="small danger" data-act="remove" data-id="${esc(id)}">Remover este provedor</button></p>` : ''}`;
}

function addTab() {
  return `<h3>Adicionar provedor</h3>
    <p class="muted">Qualquer serviço compatível com a API da OpenAI funciona. Escolha um modelo pronto ou o personalizado.</p>
    <div class="preset-grid">${PRESETS.map((p) => `<button class="preset" data-preset="${p.slug}"><b>${esc(p.label)}</b><small>${esc(p.baseUrl || (p.variant ? `API da Anthropic · ${p.variant}` : 'você informa a URL'))}</small></button>`).join('')}</div>
    <p class="muted">O GitHub Models foi descontinuado pelo GitHub em julho de 2026; para modelos da Microsoft/OpenAI use o Azure AI Foundry.</p>`;
}

$('#set-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { SET.tab = b.dataset.tab; renderSettings(); } });
$('#set-body').addEventListener('input', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (e.target.type === 'number' && v !== '') v = Number(v);
  if (k === 'editor.tabSize') v = Number(v);
  setPath(SET.draft, k, v);
  SET.dirty = true;
  if (k === 'approval') $$('.radio-card').forEach((c) => c.classList.toggle('sel', $('input', c).checked));
  if (/^providers\.[^.]+\.(apiKey|baseUrl|label)$/.test(k)) {
    // atualiza só a bolinha de status, sem perder o foco do campo
    const { prov } = settingsTabs();
    for (const t of prov) { const btn = $(`.set-tab[data-tab="${CSS.escape(t.id)}"] .dot`); btn?.classList.toggle('on', t.ready); }
  }
});
$('#set-body').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act],[data-preset]');
  if (!b) return;
  e.preventDefault();
  const id = b.dataset.id;
  const D = SET.draft;
  if (b.dataset.preset) {
    const pr = PRESETS.find((x) => x.slug === b.dataset.preset);
    const nid = `custom_${pr.slug}_${Math.random().toString(36).slice(2, 6)}`;
    D.providers[nid] = { label: pr.label, type: pr.type || 'openai', variant: pr.variant || '', apiKey: '', baseUrl: pr.baseUrl, model: '', priceIn: 0, priceOut: 0, keyUrl: pr.keyUrl, note: pr.note || '', ...(pr.region ? { region: pr.region } : {}), ...(pr.variant === 'vertex' ? { project: '' } : {}) };
    SET.tab = `p:${nid}`; SET.dirty = true; renderSettings();
    return;
  }
  switch (b.dataset.act) {
    case 'trust': await setTrust(!S.trusted); renderSettings(); break;
    case 'orbrowse':
      openModelBrowser({ providerId: id, provider: D.providers[id], current: D.providers[id].model, onPick: (m) => {
        Object.assign(D.providers[id], { model: m.id, priceIn: m.free ? 0 : (m.priceIn ?? D.providers[id].priceIn), priceOut: m.free ? 0 : (m.priceOut ?? D.providers[id].priceOut) });
        SET.dirty = true; renderSettings(); toast(`${m.name} selecionado${m.free ? ' (grátis)' : ` · US$ ${fmtPrice(m.priceIn)} / ${fmtPrice(m.priceOut)} por milhão`}. Clique em Salvar.`, 'ok');
      } });
      break;
    case 'eye': { const i = b.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; break; }
    case 'default': D.defaultProvider = id; SET.dirty = true; renderSettings(); break;
    case 'remove':
      if (!confirm(`Remover ${D.providers[id].label}?`)) return;
      delete D.providers[id]; D.deleted.push(id); if (D.defaultProvider === id) D.defaultProvider = 'anthropic';
      SET.tab = 'geral'; SET.dirty = true; renderSettings(); break;
    case 'test':
      SET.tests[id] = { loading: true }; renderSettings();
      SET.tests[id] = await api('/api/providers/test', { method: 'POST', body: { id, provider: D.providers[id] } }).catch((err) => ({ ok: false, error: err.message }));
      if (SET.tab === `p:${id}`) renderSettings();
      break;
    case 'models': {
      SET.models[id] = { loading: true }; renderSettings();
      const r = await api('/api/providers/models', { method: 'POST', body: { id, provider: D.providers[id] } }).catch((err) => ({ ok: false, error: err.message }));
      SET.models[id] = r.ok ? { list: r.models } : { error: r.error };
      if (SET.tab === `p:${id}`) { renderSettings(); if (r.ok) $(`[data-k="providers.${CSS.escape(id)}.model"]`)?.focus(); }
      break;
    }
  }
});
$('#set-cancel').onclick = () => { if (!SET.dirty || confirm('Descartar as alterações?')) $('#dlg-settings').close(); };
$('#dlg-settings').addEventListener('cancel', (e) => { if (SET.dirty && !confirm('Descartar as alterações?')) e.preventDefault(); });
$('#set-save').onclick = async () => {
  try {
    const body = clone(SET.draft);
    S.config = await api('/api/config', { method: 'PUT', body });
    SET.dirty = false;
    $('#dlg-settings').close();
    applyEditorSettings();
    renderAgents();
    toast('Configurações salvas.', 'ok');
  } catch (err) { toast(err.message, 'error'); }
};

/* ---------- Visões ---------- */
function setView(v) {
  S.view = v;
  $$('.views button').forEach((x) => x.classList.toggle('active', x.dataset.view === v));
  $('#view-editor').classList.toggle('hidden', v !== 'editor');
  $('#view-manager').classList.toggle('hidden', v !== 'manager');
}
$$('.views button').forEach((b) => { b.onclick = () => setView(b.dataset.view); });

/* ---------- Eventos em tempo real ---------- */
let treeTimer;
function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('procs', (e) => { S.procs = JSON.parse(e.data); renderProcs(); });
  es.addEventListener('friends', (e) => window.dispatchEvent(new CustomEvent('lg:friends', { detail: JSON.parse(e.data) })));
  es.addEventListener('agent', (e) => {
    const a = JSON.parse(e.data);
    window.dispatchEvent(new CustomEvent('lg:agent', { detail: a }));
    S.agents[a.id] = a;
    if (S.full[a.id]) Object.assign(S.full[a.id], a);
    renderAgents();
  });
  es.addEventListener('timeline', (e) => {
    const { agentId, item } = JSON.parse(e.data);
    const f = S.full[agentId];
    if (!f) return;
    const i = f.timeline.findIndex((x) => x.id === item.id);
    if (i >= 0) f.timeline[i] = item; else f.timeline.push(item);
    upsertItem(agentId, item);
  });
  es.addEventListener('agent_removed', (e) => {
    const { id } = JSON.parse(e.data);
    delete S.agents[id]; delete S.full[id];
    if (S.selected === id) S.selected = null;
    renderAgents();
  });
  es.addEventListener('file', (e) => {
    const { path, by } = JSON.parse(e.data);
    clearTimeout(treeTimer);
    treeTimer = setTimeout(loadTree, 300);
    if (by === 'user') return;
    if (path) {
      if (S.files.has(path)) reloadFromDisk(path);
      else if (ED().followAgent && S.view === 'editor' && ![...S.files.values()].some((f) => f.dirty)) {
        revealInTree(path);
        openFile(path).catch(() => {});
      }
    } else for (const p of S.files.keys()) reloadFromDisk(p);
  });
  es.onopen = () => document.body.classList.remove('offline');
  es.onerror = () => { document.body.classList.add('offline'); es.close(); setTimeout(connectEvents, 2000); };
}

window.addEventListener('blur', () => { if (ED().autoSave === 'onFocusChange') saveAllDirty(); });
window.addEventListener('beforeunload', (e) => { if ([...S.files.values()].some((f) => f.dirty)) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Início ---------- */
(async function init() {
  const st = await api('/api/state');
  S.config = st.config;
  S.trusted = st.trusted; S.procs = st.procs || [];
  renderTrust(); renderProcs();
  applyEditorSettings();
  $('#project').textContent = `· ${st.name}`;
  $('#sb-project').textContent = `📁 ${st.name}`;
  $('#sb-project').title = st.root;
  document.title = `${st.name} — LastGravity`;
  for (const a of st.agents) S.agents[a.id] = a;
  const fromHash = (location.hash.match(/agent=([\w-]+)/) || [])[1];
  if (fromHash && S.agents[fromHash]) await selectAgent(fromHash);
  else if (st.agents[0]) await selectAgent(st.agents[0].id); else renderAgents();
  if (new URLSearchParams(location.search).get('embed')) document.body.classList.add('embedded');
  await loadTree();
  connectEvents();
  S.monaco = await monacoReady;
})().catch((e) => { document.body.innerHTML = `<div class="placeholder">Falha ao iniciar: ${esc(e.message)}</div>`; });
