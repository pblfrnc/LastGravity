// Catálogo de modelos do OpenRouter: busca, normaliza (preço por milhão de tokens, grátis/pago,
// ferramentas, imagens, contexto) e guarda em cache por 10 minutos.
const { errorFrom, friendlyError } = require('./providers/util');

const TTL = 10 * 60 * 1000;
const cache = new Map(); // base -> { t, models }

const isOpenRouter = (pcfg) => /openrouter\.ai/i.test(pcfg?.baseUrl || '');
const perMillion = (v) => Math.round(Number(v) * 1e6 * 10000) / 10000;

function normalize(m) {
  const pi = Number(m.pricing?.prompt), po = Number(m.pricing?.completion);
  const variable = !Number.isFinite(pi) || !Number.isFinite(po) || pi < 0 || po < 0;
  const free = !variable && pi === 0 && po === 0;
  const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
  const inputs = m.architecture?.input_modalities || [];
  return {
    id: m.id,
    name: m.name || m.id,
    author: String(m.id || '').split('/')[0],
    free,
    variable,
    priceIn: variable ? null : perMillion(pi),
    priceOut: variable ? null : perMillion(po),
    context: m.context_length || m.top_provider?.context_length || null,
    maxOutput: m.top_provider?.max_completion_tokens || null,
    tools: params.includes('tools'),
    reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
    vision: inputs.includes('image'),
    created: m.created || 0,
    expires: m.expiration_date || null,
    description: String(m.description || '').replace(/\s+/g, ' ').slice(0, 240),
  };
}

async function listModels(pcfg, { refresh = false } = {}) {
  const base = (pcfg?.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const hit = cache.get(base);
  if (!refresh && hit && Date.now() - hit.t < TTL) return { models: hit.models, fetchedAt: hit.t };
  const headers = { accept: 'application/json' };
  if (pcfg?.apiKey) headers.authorization = `Bearer ${pcfg.apiKey}`;
  let res;
  try { res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(30000) }); }
  catch (e) { throw new Error(friendlyError(e, base)); }
  if (res.status === 401 && !pcfg?.apiKey) throw new Error('O OpenRouter pediu autenticação: cole sua chave do OpenRouter (aba OpenRouter) para listar os modelos.');
  if (!res.ok) throw await errorFrom(res, 'OpenRouter');
  const j = await res.json();
  const models = (j.data || []).filter((m) => m && m.id).map(normalize);
  cache.set(base, { t: Date.now(), models });
  return { models, fetchedAt: Date.now() };
}

// Preço de um modelo, a partir do catálogo em cache (para o custo dos agentes ficar certo por modelo).
function priceFor(pcfg, model) {
  const base = (pcfg?.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const m = cache.get(base)?.models.find((x) => x.id === model);
  if (!m || m.variable) return null;
  return { priceIn: m.priceIn, priceOut: m.priceOut, free: m.free, tools: m.tools };
}

module.exports = { listModels, normalize, priceFor, isOpenRouter };
