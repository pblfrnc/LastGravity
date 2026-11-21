function mergeSameRole(list, merge) {
  const out = [];
  for (const m of list) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) out[out.length - 1] = merge(last, m);
    else out.push(m);
  }
  return out;
}

// Remove campos que alguns provedores rejeitam (ex.: required vazio).
function cleanSchema(s) {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'required' && Array.isArray(v) && !v.length) continue;
    o[k] = cleanSchema(v);
  }
  return o;
}

const newId = (p = 'call') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Lê um corpo Server-Sent Events e devolve { event, data } a cada mensagem.
async function* sse(res, { idleMs = Number(process.env.LASTGRAVITY_STREAM_IDLE_MS) || 120000 } = {}) {
  const reader = res.body.getReader();
  // Vigia de inatividade: se o provedor parar de mandar dados, aborta em vez de travar para sempre.
  const read = () => new Promise((resolve, reject) => {
    const t = setTimeout(() => { reader.cancel().catch(() => {}); reject(Object.assign(new Error(`O provedor parou de responder (sem dados há ${Math.round(idleMs / 1000)} s).`), { retryable: true })); }, idleMs);
    reader.read().then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
  const dec = new TextDecoder();
  let buf = '';
  const parse = (raw) => {
    let event = 'message';
    const data = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return data.length ? { event, data: data.join('\n') } : null;
  };
  for (;;) {
    const { done, value } = await read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const msg = parse(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
      if (msg) yield msg;
    }
  }
  const tail = parse(buf.trim());
  if (tail) yield tail;
}

async function errorFrom(res, label) {
  const t = await res.text().catch(() => '');
  let msg = t;
  try { const j = JSON.parse(t); msg = j.error?.message || j.message || (Array.isArray(j) && j[0]?.error?.message) || t; } catch {}
  return new Error(`${label} ${res.status}: ${String(msg).slice(0, 500)}`);
}

const isLocalUrl = (u) => /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(u || '');

// Traduz erros de rede crus ("fetch failed") em algo que o usuário entende.
function friendlyError(e, baseUrl) {
  const code = e?.cause?.code || '';
  if (e?.message === 'fetch failed' || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/.test(code)) {
    const where = baseUrl || 'o servidor';
    return isLocalUrl(baseUrl)
      ? `Não foi possível conectar em ${where}. O programa local (Ollama, LM Studio…) está aberto?`
      : `Não foi possível conectar em ${where}${code ? ` (${code})` : ''}. Verifique a URL e a sua internet.`;
  }
  return e?.message || String(e);
}

const truncated = (label) => Object.assign(new Error(`${label}: a conexão terminou no meio da resposta.`), { retryable: true });

module.exports = { truncated, friendlyError, mergeSameRole, cleanSchema, newId, sse, errorFrom, isLocalUrl };
