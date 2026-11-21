// Claude via API Anthropic (Messages + tool use), com streaming.
// Variantes: direto (api.anthropic.com ou proxy compatível), Amazon Bedrock (chave de API do Bedrock)
// e Google Vertex AI (token do gcloud). Usa cache de prompt para baratear sessões longas.
const { execFile } = require('child_process');
const { mergeSameRole, sse, errorFrom, truncated } = require('./util');

function userContent(m) {
  const content = [];
  for (const img of m.images || []) content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
  content.push({ type: 'text', text: m.content || '…' });
  return content;
}

function convert(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: userContent(m) });
    else if (m.role === 'assistant') {
      const content = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls || []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args && !c.args._raw ? c.args : {} });
      if (!content.length) content.push({ type: 'text', text: '…' });
      out.push({ role: 'assistant', content });
    } else if (m.role === 'tool') {
      out.push({ role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output, is_error: !!r.isError })) });
    }
  }
  return mergeSameRole(out, (a, b) => ({ role: a.role, content: [...a.content, ...b.content] }));
}

// Marca pontos de cache: fim do system/ferramentas e a última mensagem (o histórico anterior é reaproveitado).
function withCache(body) {
  if (typeof body.system === 'string' && body.system) body.system = [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }];
  if (body.tools?.length) body.tools[body.tools.length - 1] = { ...body.tools[body.tools.length - 1], cache_control: { type: 'ephemeral' } };
  const last = body.messages[body.messages.length - 1];
  if (last && Array.isArray(last.content) && last.content.length) {
    const i = last.content.length - 1;
    last.content[i] = { ...last.content[i], cache_control: { type: 'ephemeral' } };
  }
  return body;
}

/* ---------- Vertex: token do gcloud (ou o informado no campo de chave) ---------- */
let vertexToken = { value: '', exp: 0 };
function gcloudToken() {
  if (vertexToken.value && Date.now() < vertexToken.exp) return Promise.resolve(vertexToken.value);
  return new Promise((resolve, reject) => {
    execFile('gcloud', ['auth', 'print-access-token'], { timeout: 20000 }, (err, out) => {
      if (err) return reject(new Error('Não consegui obter o token do Google Cloud. Instale o gcloud e rode "gcloud auth login", ou cole um token de acesso no campo de chave.'));
      vertexToken = { value: out.trim(), exp: Date.now() + 45 * 60 * 1000 };
      resolve(vertexToken.value);
    });
  });
}

async function endpoint(cfg, model) {
  const variant = cfg.variant || '';
  if (variant === 'vertex') {
    const region = cfg.region || 'global';
    if (!cfg.project) throw new Error('Informe o ID do projeto do Google Cloud.');
    const host = region === 'global' ? 'aiplatform.googleapis.com' : `${region}-aiplatform.googleapis.com`;
    const token = cfg.apiKey || await gcloudToken();
    return {
      url: `https://${host}/v1/projects/${encodeURIComponent(cfg.project)}/locations/${encodeURIComponent(region)}/publishers/anthropic/models/${encodeURIComponent(model)}:streamRawPredict`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      shape: (body) => { delete body.model; body.anthropic_version = 'vertex-2023-10-16'; return body; },
      label: 'Vertex AI',
    };
  }
  if (!cfg.apiKey) throw new Error(variant === 'bedrock' ? 'Cole a chave de API do Amazon Bedrock.' : 'Chave da Anthropic não configurada (Configurações ou ANTHROPIC_API_KEY).');
  const base = (cfg.baseUrl || (variant === 'bedrock' ? `https://bedrock-runtime.${cfg.region || 'us-east-1'}.amazonaws.com/anthropic` : 'https://api.anthropic.com')).replace(/\/$/, '');
  const headers = { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
  if (variant === 'bedrock') headers.authorization = `Bearer ${cfg.apiKey}`;
  return { url: `${base}/v1/messages`, headers, shape: (b) => b, label: variant === 'bedrock' ? 'Bedrock' : 'Anthropic', base };
}

async function chat({ cfg, model, system, messages, tools, signal, onText, params = {} }) {
  const ep = await endpoint(cfg, model);
  let body = { model, max_tokens: Number(params.maxTokens) > 0 ? Number(params.maxTokens) : 16000, system, messages: convert(messages), stream: true };
  if (typeof params.temperature === 'number') body.temperature = Math.min(1, params.temperature); // Anthropic aceita 0–1
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (cfg.promptCache !== false) body = withCache(body);
  const res = await fetch(ep.url, { method: 'POST', signal, headers: ep.headers, body: JSON.stringify(ep.shape(body)) });
  if (!res.ok) throw await errorFrom(res, ep.label);

  let text = '', stopReason = '', finished = false;
  const blocks = {};
  const usage = { input: 0, output: 0 };
  for await (const ev of sse(res)) {
    let d;
    try { d = JSON.parse(ev.data); } catch { continue; }
    if (d.type === 'message_start') {
      const u = d.message?.usage || {};
      usage.input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      usage.output = u.output_tokens || 0;
    } else if (d.type === 'content_block_start') {
      blocks[d.index] = { ...d.content_block, json: '' };
      if (d.content_block.type === 'text' && d.content_block.text) { text += d.content_block.text; onText?.(d.content_block.text); }
    } else if (d.type === 'content_block_delta') {
      const b = blocks[d.index];
      if (d.delta?.type === 'text_delta') { text += d.delta.text; onText?.(d.delta.text); }
      else if (d.delta?.type === 'input_json_delta' && b) b.json += d.delta.partial_json;
    } else if (d.type === 'message_delta') {
      if (d.usage?.output_tokens) usage.output = d.usage.output_tokens;
      if (d.delta?.stop_reason) stopReason = d.delta.stop_reason;
    } else if (d.type === 'message_stop') {
      finished = true;
    } else if (d.type === 'error') {
      throw Object.assign(new Error(`${ep.label}: ${d.error?.message || ev.data}`), { retryable: /overloaded|rate|api_error/i.test(d.error?.type || '') });
    }
  }
  if (!finished) throw truncated(ep.label);
  const toolCalls = Object.keys(blocks).sort((a, b) => a - b).map((k) => blocks[k]).filter((b) => b.type === 'tool_use').map((b) => {
    let args = b.input || {};
    if (b.json) { try { args = JSON.parse(b.json); } catch { args = { _raw: b.json }; } }
    return { id: b.id, name: b.name, args };
  });
  return { text, toolCalls, usage, stopReason };
}

async function listModels(cfg) {
  if (cfg.variant === 'vertex' || cfg.variant === 'bedrock') throw new Error('Para esta plataforma, digite o ID do modelo como aparece no console dela.');
  const ep = await endpoint(cfg, '');
  const res = await fetch(`${ep.base}/v1/models?limit=100`, { headers: ep.headers });
  if (!res.ok) throw await errorFrom(res, 'Anthropic');
  const j = await res.json();
  return (j.data || []).map((m) => m.id);
}

module.exports = { chat, convert, listModels };
