// Ollama pela API nativa (/api/chat), com contexto configurável (num_ctx).
// O endpoint compatível com OpenAI (/v1) usa o contexto padrão do Ollama, pequeno, e corta
// em silêncio o system prompt e as ferramentas — por isso o LastGravity usa a API nativa.
const { cleanSchema, newId, errorFrom } = require('./util');

const base = (cfg) => (cfg.baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/$/, '');

function convert(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content || '…', ...(m.images?.length ? { images: m.images.map((i) => i.data) } : {}) });
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || '' };
      if (m.toolCalls?.length) msg.tool_calls = m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args && !c.args._raw ? c.args : {} } }));
      out.push(msg);
    } else if (m.role === 'tool') {
      for (const r of m.results) out.push({ role: 'tool', content: r.output, tool_name: r.name });
    }
  }
  return out;
}

async function* ndjson(res, idleMs = Number(process.env.LASTGRAVITY_STREAM_IDLE_MS) || 300000) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { reader.cancel().catch(() => {}); reject(Object.assign(new Error(`O Ollama parou de responder (sem dados há ${Math.round(idleMs / 1000)} s).`), { retryable: true })); }, idleMs);
      reader.read().then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
    });
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { yield JSON.parse(line); } catch {} }
    }
  }
  if (buf.trim()) { try { yield JSON.parse(buf); } catch {} }
}

async function chat({ cfg, model, system, messages, tools, signal, onText, params = {} }) {
  const options = { num_ctx: Number(cfg.numCtx) || 32768 };
  if (typeof params.temperature === 'number') options.temperature = params.temperature;
  if (params.maxTokensSet && Number(params.maxTokens) > 0) options.num_predict = Number(params.maxTokens);
  const body = { model, messages: convert(system, messages), stream: true, options };
  if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: cleanSchema(t.parameters) } }));
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetch(`${base(cfg)}/api/chat`, { method: 'POST', signal, headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await errorFrom(res, 'Ollama');
    if (/does not support tools/i.test(err.message)) err.message = `O modelo "${model}" não suporta ferramentas no Ollama. Use um modelo com suporte (ex.: qwen2.5-coder, llama3.1, qwen3) — veja ollama.com/search?c=tools.`;
    if (/not found/i.test(err.message)) err.message = `Modelo "${model}" não encontrado no Ollama. Rode: ollama pull ${model}`;
    throw err;
  }
  let text = '', done = false, doneReason = '';
  const toolCalls = [];
  const usage = { input: 0, output: 0 };
  for await (const d of ndjson(res)) {
    if (d.error) throw new Error(`Ollama: ${d.error}`);
    const c = d.message?.content;
    if (c) { text += c; onText?.(c); }
    for (const tc of d.message?.tool_calls || []) {
      let args = tc.function?.arguments ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { _raw: args }; } }
      toolCalls.push({ id: newId(), name: tc.function?.name, args });
    }
    if (d.done) { done = true; doneReason = d.done_reason || ''; usage.input = d.prompt_eval_count || 0; usage.output = d.eval_count || 0; }
  }
  if (!done) throw Object.assign(new Error('Ollama: a conexão terminou no meio da resposta.'), { retryable: true });
  return { text, toolCalls: toolCalls.filter((t) => t.name), usage, stopReason: doneReason === 'length' ? 'max_tokens' : doneReason };
}

async function listModels(cfg) {
  const res = await fetch(`${base(cfg)}/api/tags`);
  if (!res.ok) throw await errorFrom(res, 'Ollama');
  const j = await res.json();
  return (j.models || []).map((m) => m.name).sort();
}

module.exports = { chat, convert, listModels };
