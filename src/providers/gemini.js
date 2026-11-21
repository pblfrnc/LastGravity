// Gemini via Google AI (streamGenerateContent + function calling).
// Guarda as "parts" originais para devolver thought signatures, exigidas pelos modelos Gemini 3.
const { mergeSameRole, cleanSchema, newId, sse, errorFrom, truncated } = require('./util');

// Assinatura documentada pelo Google para chamadas de função vindas de outro modelo/histórico.
const SKIP_SIG = 'skip_thought_signature_validator';

function convert(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', parts: [...(m.images || []).map((i) => ({ inlineData: { mimeType: i.mediaType, data: i.data } })), { text: m.content || '…' }] });
    else if (m.role === 'assistant') {
      if (m.raw?.gemini?.length) { out.push({ role: 'model', parts: m.raw.gemini }); continue; }
      const parts = [];
      if (m.text) parts.push({ text: m.text });
      for (const c of m.toolCalls || []) parts.push({ functionCall: { name: c.name, args: c.args || {} }, thoughtSignature: SKIP_SIG });
      if (!parts.length) parts.push({ text: '…' });
      out.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      out.push({ role: 'user', parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: { content: r.output } } })) });
    }
  }
  return mergeSameRole(out, (a, b) => ({ role: a.role, parts: [...a.parts, ...b.parts] }));
}

const base = (cfg) => (cfg.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
const needKey = (cfg) => { if (!cfg.apiKey) throw new Error('Chave do Gemini não configurada (Configurações ou GEMINI_API_KEY).'); };

// Gemini aceita só um subconjunto do JSON Schema (ferramentas MCP podem trazer campos extras).
const DROP = new Set(['$schema', '$id', '$comment', 'additionalProperties', 'examples', 'default', 'const', '$defs', 'definitions']);
function geminiSchema(s) {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) if (!DROP.has(k)) o[k] = k === 'properties' && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, geminiSchema(pv)])) : geminiSchema(v);
  return o;
}

function generationConfig(params = {}) {
  const g = {};
  if (typeof params.temperature === 'number') g.temperature = params.temperature;
  if (params.maxTokensSet && Number(params.maxTokens) > 0) g.maxOutputTokens = Number(params.maxTokens);
  return Object.keys(g).length ? g : null;
}

async function chat({ cfg, model, system, messages, tools, signal, onText, params }) {
  needKey(cfg);
  const body = { systemInstruction: { parts: [{ text: system }] }, contents: convert(messages) };
  const gen = generationConfig(params);
  if (gen) body.generationConfig = gen;
  if (tools.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(cleanSchema(t.parameters)) })) }];
  const res = await fetch(`${base(cfg)}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFrom(res, 'Gemini');

  let text = '', finishReason = '';
  const toolCalls = [];
  const raw = [];
  const usage = { input: 0, output: 0 };
  for await (const ev of sse(res)) {
    let d;
    try { d = JSON.parse(ev.data); } catch { continue; }
    if (d.error) throw new Error(`Gemini: ${d.error.message}`);
    for (const p of d.candidates?.[0]?.content?.parts || []) {
      raw.push(p);
      if (p.text && !p.thought) { text += p.text; onText?.(p.text); }
      if (p.functionCall) toolCalls.push({ id: p.functionCall.id || newId(), name: p.functionCall.name, args: p.functionCall.args || {} });
    }
    const fr = d.candidates?.[0]?.finishReason;
    if (fr) finishReason = fr;
    const u = d.usageMetadata;
    if (u) { usage.input = u.promptTokenCount || usage.input; usage.output = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) || usage.output; }
  }
  if (!finishReason) throw truncated('Gemini');
  if (/MALFORMED_FUNCTION_CALL/.test(finishReason)) throw Object.assign(new Error('Gemini gerou uma chamada de ferramenta inválida.'), { retryable: true });
  if (/SAFETY|RECITATION|PROHIBITED|BLOCKLIST|SPII/.test(finishReason) && !text && !toolCalls.length) throw new Error(`Gemini recusou a resposta (${finishReason}).`);
  return { text, toolCalls, raw: { gemini: raw }, usage, stopReason: finishReason === 'MAX_TOKENS' ? 'max_tokens' : finishReason };
}

async function listModels(cfg) {
  needKey(cfg);
  const res = await fetch(`${base(cfg)}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': cfg.apiKey } });
  if (!res.ok) throw await errorFrom(res, 'Gemini');
  const j = await res.json();
  return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
}

module.exports = { chat, convert, listModels, generationConfig, geminiSchema };
