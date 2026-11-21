// OpenAI Chat Completions com streaming — serve também para Ollama, OpenRouter, DeepSeek,
// Groq, Mistral, xAI, LM Studio e qualquer API compatível (basta mudar a URL base).
const { cleanSchema, newId, sse, errorFrom, isLocalUrl, truncated } = require('./util');

function convert(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.images?.length) out.push({ role: 'user', content: [{ type: 'text', text: m.content || '…' }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${i.data}` } }))] });
      else out.push({ role: 'user', content: m.content });
    }
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args && !c.args._raw ? c.args : {}) } }));
      }
      if (!msg.content && !msg.tool_calls) msg.content = '…';
      out.push(msg);
    } else if (m.role === 'tool') {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.output });
    }
  }
  return out;
}

const base = (cfg) => (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
function headers(cfg) {
  const h = { 'content-type': 'application/json' };
  if (cfg.apiKey) h.authorization = `Bearer ${cfg.apiKey}`;
  else if (!isLocalUrl(base(cfg))) throw new Error(`Chave de API não configurada para ${base(cfg)}.`);
  return h;
}

const noStreamOptions = new Set();

// Só envia o que o usuário definiu: muitas APIs compatíveis rejeitam parâmetros desconhecidos.
function applyParams(body, params = {}) {
  if (typeof params.temperature === 'number') body.temperature = params.temperature;
  if (params.maxTokensSet && Number(params.maxTokens) > 0) body.max_tokens = Number(params.maxTokens);
  if (params.reasoningEffort) body.reasoning_effort = params.reasoningEffort;
  return body;
}

async function chat({ cfg, model, system, messages, tools, signal, onText, params }) {
  const body = applyParams({ model, messages: convert(system, messages), stream: true, stream_options: { include_usage: true } }, params);
  if (tools.length) {
    body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: cleanSchema(t.parameters) } }));
    body.tool_choice = 'auto';
  }
  // A OpenAI oficial usa max_completion_tokens (modelos de raciocínio rejeitam max_tokens).
  if (body.max_tokens && /api\.openai\.com/.test(base(cfg))) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; }
  if (noStreamOptions.has(base(cfg))) delete body.stream_options;
  let res = await fetch(`${base(cfg)}/chat/completions`, { method: 'POST', signal, headers: headers(cfg), body: JSON.stringify(body) });
  if (!res.ok && res.status === 400 && body.stream_options) {
    // Alguns servidores compatíveis não conhecem stream_options: tenta de novo sem e lembra disso.
    const err = await errorFrom(res, base(cfg));
    if (!/stream_options|include_usage|unrecognized|unknown|extra/i.test(err.message)) throw err;
    noStreamOptions.add(base(cfg));
    delete body.stream_options;
    res = await fetch(`${base(cfg)}/chat/completions`, { method: 'POST', signal, headers: headers(cfg), body: JSON.stringify(body) });
  }
  if (!res.ok) throw await errorFrom(res, base(cfg));

  let text = '', finish = '', done = false;
  const calls = [];
  const usage = { input: 0, output: 0 };
  for await (const ev of sse(res)) {
    if (ev.data === '[DONE]') { done = true; break; }
    let d;
    try { d = JSON.parse(ev.data); } catch { continue; }
    if (d.error) throw new Error(`${base(cfg)}: ${d.error.message || JSON.stringify(d.error)}`);
    if (d.usage) { usage.input = d.usage.prompt_tokens || usage.input; usage.output = d.usage.completion_tokens || usage.output; }
    if (d.choices?.[0]?.finish_reason) finish = d.choices[0].finish_reason;
    const delta = d.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) { text += delta.content; onText?.(delta.content); }
    for (const tc of delta.tool_calls || []) {
      let slot;
      if (tc.index !== undefined) slot = calls[tc.index] ||= { id: '', name: '', args: '' };
      else {
        slot = (tc.id && calls.find((c) => c.id === tc.id)) || null;
        if (!slot) { slot = { id: '', name: '', args: '' }; calls.push(slot); }
      }
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name && !slot.name) slot.name = tc.function.name;
      if (tc.function?.arguments) slot.args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
    }
  }
  const toolCalls = calls.filter(Boolean).filter((c) => c.name).map((c) => {
    let args = {};
    try { args = c.args ? JSON.parse(c.args) : {}; } catch { args = { _raw: c.args }; }
    return { id: c.id || newId(), name: c.name, args };
  });
  if (!done && !finish) throw truncated(base(cfg));
  return { text, toolCalls, usage, stopReason: finish === 'length' ? 'max_tokens' : finish };
}

async function listModels(cfg) {
  const res = await fetch(`${base(cfg)}/models`, { headers: headers(cfg) });
  if (!res.ok) throw await errorFrom(res, base(cfg));
  const j = await res.json();
  return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
}

module.exports = { chat, convert, listModels, applyParams };
