// Configuração global (chaves de API, modelos, política de aprovação).
// Fica em ~/.lastgravity/config.json — nunca dentro do projeto.
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.LASTGRAVITY_HOME || path.join(os.homedir(), '.lastgravity');
const FILE = path.join(DIR, 'config.json');

// Os nomes de modelo são só sugestões iniciais: edite em Configurações
// conforme os modelos disponíveis na sua conta.
const DEFAULTS = {
  defaultProvider: 'anthropic',
  approval: 'ask-commands', // auto | ask-commands | ask-all
  maxSteps: 40,
  repoMapInPrompt: true,
  notifications: true,
  appearance: { theme: 'dark' }, // dark | light | system
  // Preferências de IDE (aplicadas na interface)
  editor: {
    fontSize: 13, fontFamily: '', tabSize: 2, insertSpaces: true, wordWrap: 'off', minimap: false,
    lineNumbers: 'on', renderWhitespace: 'none', cursorBlinking: 'blink', bracketPairs: true, smoothScrolling: true,
    autoSave: 'off', autoSaveDelay: 1000, trimTrailingWhitespace: false, insertFinalNewline: false,
    terminalFontSize: 12, followAgent: true, confirmDelete: true,
  },
  // Roteamento (inspirado no OpenClaude): o sub-agente explorador pode usar outro modelo, mais barato.
  routing: { explore: { providerId: '', model: '' }, plan: { providerId: '', model: '' }, general: { providerId: '', model: '' }, frontend: { providerId: '', model: '' } },
  // Parâmetros de geração aplicados a todos os provedores (null = padrão do provedor).
  modelParams: { temperature: null, maxTokens: 16000, reasoningEffort: '' },
  favoriteModels: [], // [{ providerId, model, label }]
  // Servidores MCP (Model Context Protocol), no mesmo formato usado por outros clientes MCP.
  mcpServers: {}, // { nome: { enabled, type: 'stdio'|'http', command, args, env, url, headers, trusted } }
  skills: { disabled: [] },
  // Busca na web para os agentes: duckduckgo (sem chave), brave ou tavily (com chave).
  webSearch: { provider: 'duckduckgo', apiKey: '' },
  // Pastas em que você confia (autônomo liberado, skills do projeto carregadas). Só muda por /api/trust.
  trustedFolders: [],
  subagentMaxSteps: { explore: 15, plan: 20, general: 30, frontend: 30 },
  providers: {
    anthropic: { label: 'Claude (Anthropic)', type: 'anthropic', apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', priceIn: 0, priceOut: 0 },
    gemini: { label: 'Gemini (Google)', type: 'gemini', apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3-pro-preview', priceIn: 0, priceOut: 0 },
    openai: { label: 'OpenAI', type: 'openai', apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', priceIn: 0, priceOut: 0 },
    openrouter: { label: 'OpenRouter (qualquer modelo)', type: 'openai', apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5', priceIn: 0, priceOut: 0 },
    ollama: { label: 'Ollama (local, grátis)', type: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434', model: 'qwen2.5-coder:14b', numCtx: 32768, priceIn: 0, priceOut: 0 },
    mock: { label: 'Simulado (teste sem chave)', type: 'mock', apiKey: '', baseUrl: '', model: 'mock', priceIn: 0, priceOut: 0 },
  },
};

const ENV_KEYS = { anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' };

function load() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  const cfg = { ...DEFAULTS, ...saved, routing: { ...DEFAULTS.routing, ...(saved.routing || {}) }, editor: { ...DEFAULTS.editor, ...(saved.editor || {}) }, providers: {} };
  cfg.modelParams = normalizeParams({ ...DEFAULTS.modelParams, ...(saved.modelParams || {}) });
  cfg.favoriteModels = normalizeFavorites(saved.favoriteModels);
  cfg.mcpServers = normalizeMcp(saved.mcpServers || {});
  cfg.skills = normalizeSkills(saved.skills);
  cfg.webSearch = { ...DEFAULTS.webSearch, ...(saved.webSearch || {}) };
  cfg.appearance = { ...DEFAULTS.appearance, ...(saved.appearance || {}) };
  cfg.trustedFolders = Array.isArray(saved.trustedFolders) ? saved.trustedFolders.filter((x) => typeof x === 'string') : [];
  cfg.subagentMaxSteps = { ...DEFAULTS.subagentMaxSteps, ...(saved.subagentMaxSteps || {}) };
  for (const [id, def] of Object.entries(DEFAULTS.providers)) {
    cfg.providers[id] = { ...def, ...(saved.providers?.[id] || {}), type: def.type };
  }
  if (/\/v1\/?$/.test(cfg.providers.ollama.baseUrl || '')) cfg.providers.ollama.baseUrl = cfg.providers.ollama.baseUrl.replace(/\/v1\/?$/, ''); // migra config antiga
  for (const [id, p] of Object.entries(saved.providers || {})) {
    if (!cfg.providers[id]) cfg.providers[id] = p; // provedores personalizados
  }
  for (const [id, env] of Object.entries(ENV_KEYS)) {
    if (!cfg.providers[id].apiKey && process.env[env]) cfg.providers[id].apiKey = process.env[env];
  }
  return cfg;
}

function save(cfg) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const out = JSON.parse(JSON.stringify(cfg));
  // Chaves que vieram de variáveis de ambiente continuam só no ambiente.
  for (const [id, env] of Object.entries(ENV_KEYS)) if (out.providers[id] && process.env[env] && out.providers[id].apiKey === process.env[env]) out.providers[id].apiKey = '';
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  try { fs.chmodSync(FILE, 0o600); fs.chmodSync(DIR, 0o700); } catch {}
}

const MASK = '••••••••';
const DEFAULT_MAX_TOKENS = 16000;
const maskValue = (v) => (v ? MASK + String(v).slice(-4) : '');

// Valores de env/cabeçalhos de MCP que parecem segredos (chaves, tokens, senhas).
const SECRET_NAME = /(key$|key_|_key|apikey|token|secret|passw|pwd|auth|bearer|credential|cookie|private)|(^|_)pat(_|$)/i;
function looksSecret(name, value) {
  if (typeof value !== 'string' || !value) return false;
  if (SECRET_NAME.test(name) || /^authorization$/i.test(name)) return true;
  if (/^(sk|pk|ghp|gho|ghu|ghs|github_pat|xox[abp]|AIza|glpat)[-_]/.test(value)) return true;
  // Sequência longa sem espaços e que não parece caminho/URL/número.
  return value.length >= 24 && !/\s/.test(value) && !/^([~./\\]|[a-z]:\\|https?:\/\/)/i.test(value) && /[a-z]/i.test(value) && /\d/.test(value);
}

function masked(cfg) {
  const out = JSON.parse(JSON.stringify(cfg));
  for (const p of Object.values(out.providers)) p.apiKey = p.apiKey ? MASK + p.apiKey.slice(-4) : '';
  if (out.webSearch) out.webSearch.apiKey = maskValue(out.webSearch.apiKey);
  for (const srv of Object.values(out.mcpServers || {})) {
    for (const field of ['env', 'headers']) {
      for (const [k, v] of Object.entries(srv[field] || {})) if (looksSecret(k, v)) srv[field][k] = maskValue(v);
    }
  }
  return out;
}

// ---- Normalização dos campos novos ----
function normalizeParams(p = {}) {
  const t = p.temperature === '' || p.temperature === null || p.temperature === undefined ? null : Number(p.temperature);
  const mt = Math.round(Number(p.maxTokens));
  return {
    temperature: Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : null,
    maxTokens: Number.isFinite(mt) && mt > 0 ? Math.min(1_000_000, mt) : DEFAULT_MAX_TOKENS,
    reasoningEffort: ['', 'minimal', 'low', 'medium', 'high'].includes(p.reasoningEffort) ? p.reasoningEffort : '',
  };
}

function normalizeFavorites(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f.providerId === 'string' && typeof f.model === 'string' && f.model.trim())
    .map((f) => ({ providerId: f.providerId, model: f.model.trim(), label: String(f.label || '').slice(0, 80) }))
    .slice(0, 100);
}

function normalizeSkills(s) {
  const disabled = Array.isArray(s?.disabled) ? [...new Set(s.disabled.filter((x) => typeof x === 'string' && x))] : [];
  return { disabled };
}

const strMap = (o) => {
  const out = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (k.trim()) out[k.trim()] = v == null ? '' : String(v);
  return out;
};

function normalizeServer(s = {}) {
  const type = s.type === 'http' || s.type === 'streamable-http' || s.type === 'sse' || (!s.command && s.url) ? 'http' : 'stdio';
  const out = { enabled: s.enabled !== false, type, trusted: !!s.trusted };
  if (type === 'stdio') {
    out.command = String(s.command || '').trim();
    out.args = Array.isArray(s.args) ? s.args.map(String) : (typeof s.args === 'string' && s.args.trim() ? s.args.trim().split(/\s+/) : []);
    out.env = strMap(s.env);
  } else {
    out.url = String(s.url || '').trim();
    out.headers = strMap(s.headers);
  }
  if (Number(s.timeoutSec) > 0) out.timeoutSec = Math.min(3600, Number(s.timeoutSec));
  return out;
}

function normalizeMcp(map) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [name, s] of Object.entries(map)) {
    const n = String(name).trim().slice(0, 64);
    if (!n || !s || typeof s !== 'object') continue;
    out[n] = normalizeServer(s);
  }
  return out;
}

// Troca valores mascarados pelos valores reais já salvos (mesmo servidor ou, se renomeado, qualquer outro).
function unmaskServer(current, name, srv) {
  const prev = current.mcpServers?.[name];
  const others = Object.values(current.mcpServers || {});
  for (const field of ['env', 'headers']) {
    for (const [k, v] of Object.entries(srv[field] || {})) {
      if (typeof v !== 'string' || !v.startsWith(MASK)) continue;
      let real = prev?.[field]?.[k];
      if (real === undefined || maskValue(real) !== v) {
        real = undefined;
        for (const o of others) { const c = o[field]?.[k]; if (c !== undefined && maskValue(c) === v) { real = c; break; } }
      }
      if (real !== undefined) srv[field][k] = real;
      else delete srv[field][k]; // valor mascarado sem original conhecido: descarta em vez de gravar a máscara
    }
  }
  return srv;
}

// Parâmetros de geração no formato passado a provider.chat({ params }).
// maxTokensSet indica que o usuário mudou o padrão (OpenAI/Gemini só recebem max_tokens nesse caso).
function chatParams(cfg) {
  const p = normalizeParams(cfg?.modelParams || {});
  return { ...p, maxTokensSet: p.maxTokens !== DEFAULT_MAX_TOKENS };
}

// Resolve um servidor MCP vindo do rascunho da UI (sem salvar).
function resolveMcpDraft(current, name, draft) {
  return unmaskServer(current, name, normalizeServer(draft || {}));
}

// Mescla atualização vinda da UI, preservando chaves mascaradas.
const BUILTIN = new Set(Object.keys(DEFAULTS.providers));

// Resolve a configuração de um provedor a partir de um rascunho da UI (chave mascarada = chave salva).
function resolveDraft(current, id, draft = {}) {
  const prev = current.providers[id] || {};
  const merged = { ...prev, ...draft };
  if (typeof draft.apiKey === 'string' && draft.apiKey.startsWith(MASK)) merged.apiKey = prev.apiKey;
  return merged;
}

function update(current, incoming) {
  const { deleted = [], trustedFolders, ...rest } = incoming; // confiança só muda por /api/trust
  const next = { ...current, ...rest, trustedFolders: current.trustedFolders || [], providers: { ...current.providers } };
  if (rest.webSearch) {
    const w = { ...current.webSearch, ...rest.webSearch };
    if (typeof rest.webSearch.apiKey === 'string' && rest.webSearch.apiKey.startsWith(MASK)) w.apiKey = current.webSearch?.apiKey || '';
    if (!['duckduckgo', 'brave', 'tavily'].includes(w.provider)) w.provider = 'duckduckgo';
    next.webSearch = w;
  }
  if (rest.subagentMaxSteps) next.subagentMaxSteps = Object.fromEntries(Object.entries({ ...current.subagentMaxSteps, ...rest.subagentMaxSteps }).map(([k, v]) => [k, Math.min(200, Math.max(1, Number(v) || 15))]));
  if (rest.routing) next.routing = { ...current.routing, ...rest.routing };
  if (rest.editor) next.editor = { ...current.editor, ...rest.editor };
  if (rest.appearance) next.appearance = { ...current.appearance, ...rest.appearance, theme: ['dark', 'light', 'system'].includes(rest.appearance.theme) ? rest.appearance.theme : (current.appearance?.theme || 'dark') };
  if (rest.modelParams) next.modelParams = normalizeParams({ ...current.modelParams, ...rest.modelParams });
  else next.modelParams = normalizeParams(current.modelParams);
  next.favoriteModels = rest.favoriteModels ? normalizeFavorites(rest.favoriteModels) : normalizeFavorites(current.favoriteModels);
  next.skills = rest.skills ? normalizeSkills({ ...current.skills, ...rest.skills }) : normalizeSkills(current.skills);
  if (rest.mcpServers) {
    // A lista vinda da UI substitui a atual (permite remover), mas segredos mascarados são preservados.
    const incomingMcp = normalizeMcp(rest.mcpServers);
    for (const [n, srv] of Object.entries(incomingMcp)) unmaskServer(current, n, srv);
    next.mcpServers = incomingMcp;
  } else next.mcpServers = normalizeMcp(current.mcpServers || {});
  if (rest.approval && !['auto', 'ask-commands', 'ask-all'].includes(rest.approval)) next.approval = current.approval;
  next.maxSteps = Math.min(500, Math.max(1, Number(next.maxSteps) || 40));
  for (const id of deleted) if (!BUILTIN.has(id)) delete next.providers[id];
  if (!next.providers[next.defaultProvider]) next.defaultProvider = 'anthropic';
  for (const [id, p] of Object.entries(incoming.providers || {})) {
    if (deleted.includes(id)) continue;
    if (!BUILTIN.has(id) && !/^custom_[\w-]+$/.test(id)) continue;
    const prev = current.providers[id] || {};
    const merged = { ...prev, ...p };
    if (typeof p.apiKey === 'string' && p.apiKey.startsWith(MASK)) merged.apiKey = prev.apiKey;
    merged.priceIn = Number(merged.priceIn) || 0;
    merged.priceOut = Number(merged.priceOut) || 0;
    if (!BUILTIN.has(id)) {
      // Personalizados: compatíveis com OpenAI (padrão), com a API da Anthropic (Bedrock/Vertex/proxies) ou Ollama.
      if (!['openai', 'anthropic', 'ollama'].includes(merged.type)) merged.type = 'openai';
      if (!['', 'bedrock', 'vertex'].includes(merged.variant || '')) merged.variant = '';
    } else merged.type = DEFAULTS.providers[id].type;
    if (id === 'ollama' && /\/v1\/?$/.test(merged.baseUrl || '')) merged.baseUrl = merged.baseUrl.replace(/\/v1\/?$/, '');
    merged.numCtx = Math.min(1_000_000, Math.max(0, Number(merged.numCtx) || 0)) || undefined;
    next.providers[id] = merged;
  }
  return next;
}

module.exports = { load, save, masked, update, resolveDraft, resolveMcpDraft, chatParams, normalizeServer, looksSecret, BUILTIN, DIR, MASK, DEFAULT_MAX_TOKENS };
