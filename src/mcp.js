// Cliente MCP (Model Context Protocol) sem dependências.
// Transportes: stdio (JSON-RPC 2.0, uma mensagem JSON por linha) e Streamable HTTP
// (POST JSON-RPC; resposta em application/json ou text/event-stream; sessão via Mcp-Session-Id).
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { sse } = require('./providers/util');

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'LastGravity', version: (() => { try { return require('../package.json').version; } catch { return '0.0.0'; } })() };
const MAX_OUT = 20000;
const STDERR_LINES = 40;

const clip = (s) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + `\n…[cortado, ${s.length - MAX_OUT} caracteres omitidos]` : s);
const rpcError = (err) => Object.assign(new Error(err?.message || 'Erro JSON-RPC'), { code: err?.code, data: err?.data });

// Garante que nenhum processo de servidor MCP fique órfão se o LastGravity sair de repente.
const LIVE = new Set();
process.once('exit', () => { for (const c of LIVE) { try { c.kill('SIGKILL'); } catch {} } });

// ---------------------------------------------------------------------------
// Transporte stdio
class StdioTransport extends EventEmitter {
  constructor({ command, args = [], env = {}, cwd }) {
    super();
    this.opts = { command, args, env, cwd };
    this.stderr = [];
    this.closing = false;
  }

  start() {
    const { command, args, env, cwd } = this.opts;
    if (!command) throw new Error('Comando não informado.');
    return new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(command, args, {
        cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32', // npx/uvx no Windows são .cmd
        windowsHide: true,
      });
      this.child = child;
      LIVE.add(child);
      let buf = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '');
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { this.pushStderr(`[stdout não-JSON] ${line.slice(0, 300)}`); continue; }
          this.emit('message', msg);
        }
      });
      let errBuf = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => {
        errBuf += d;
        const lines = errBuf.split('\n');
        errBuf = lines.pop();
        for (const l of lines) if (l.trim()) this.pushStderr(l);
        if (errBuf.length > 4000) { this.pushStderr(errBuf); errBuf = ''; }
      });
      child.stdin.on('error', () => {}); // EPIPE quando o processo morre
      child.on('error', (err) => {
        const msg = err.code === 'ENOENT'
          ? `Comando não encontrado: "${command}". Verifique se está instalado e no PATH.`
          : `Falha ao iniciar "${command}": ${err.message}`;
        this.pushStderr(msg);
        if (!settled) { settled = true; reject(new Error(msg)); }
        this.emit('close', { code: -1, error: msg });
      });
      child.on('spawn', () => { if (!settled) { settled = true; resolve(); } });
      child.on('exit', (code, signal) => {
        if (errBuf.trim()) this.pushStderr(errBuf);
        LIVE.delete(child);
        this.child = null;
        this.emit('close', { code, signal, expected: this.closing });
      });
    });
  }

  pushStderr(line) {
    this.stderr.push(line.slice(0, 500));
    if (this.stderr.length > STDERR_LINES) this.stderr.splice(0, this.stderr.length - STDERR_LINES);
  }

  send(msg) {
    if (!this.child || !this.child.stdin.writable) throw new Error('Processo do servidor MCP não está em execução.');
    this.child.stdin.write(JSON.stringify(msg) + '\n');
  }

  async close() {
    this.closing = true;
    const child = this.child;
    if (!child) return;
    await new Promise((resolve) => {
      const done = () => { clearTimeout(t1); clearTimeout(t2); resolve(); };
      child.once('exit', done);
      // Encerramento limpo: fecha stdin, depois SIGTERM, depois SIGKILL.
      try { child.stdin.end(); } catch {}
      const t1 = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 1500);
      const t2 = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 4000);
    });
  }
}

// ---------------------------------------------------------------------------
// Transporte Streamable HTTP
class HttpTransport extends EventEmitter {
  constructor({ url, headers = {} }) {
    super();
    this.url = url;
    this.headers = headers;
    this.sessionId = null;
    this.protocolVersion = null;
    this.stderr = [];
    this.controllers = new Set();
  }

  async start() {
    if (!/^https?:\/\//i.test(this.url || '')) throw new Error('URL inválida (use http:// ou https://).');
  }

  pushStderr(line) {
    this.stderr.push(String(line).slice(0, 500));
    if (this.stderr.length > STDERR_LINES) this.stderr.splice(0, this.stderr.length - STDERR_LINES);
  }

  reqHeaders() {
    const h = { ...this.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (this.sessionId) h['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) h['mcp-protocol-version'] = this.protocolVersion;
    return h;
  }

  // Envia uma mensagem; respostas chegam pelo evento 'message' (como no stdio).
  send(msg) {
    const ctrl = new AbortController();
    this.controllers.add(ctrl);
    this.post(msg, ctrl.signal)
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        this.pushStderr(e.message);
        if (msg.id !== undefined) this.emit('message', { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } });
      })
      .finally(() => this.controllers.delete(ctrl));
  }

  async post(msg, signal) {
    const res = await fetch(this.url, { method: 'POST', headers: this.reqHeaders(), body: JSON.stringify(msg), signal });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (res.status === 202 || res.status === 204) return;
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      if (res.status === 404 && this.sessionId) this.sessionId = null;
      const hint = res.status === 401 || res.status === 403 ? ' (verifique o token/cabeçalhos de autenticação)' : '';
      throw new Error(`HTTP ${res.status}${hint}: ${t.slice(0, 300)}`);
    }
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/event-stream')) {
      for await (const ev of sse(res)) {
        if (!ev.data) continue;
        let d; try { d = JSON.parse(ev.data); } catch { continue; }
        for (const m of Array.isArray(d) ? d : [d]) this.emit('message', m);
        // Uma resposta à nossa requisição encerra o fluxo.
        if (msg.id !== undefined && (Array.isArray(d) ? d : [d]).some((m) => m.id === msg.id && !m.method)) break;
      }
      return;
    }
    const text = await res.text();
    if (!text.trim()) return;
    let d; try { d = JSON.parse(text); } catch { throw new Error(`Resposta não é JSON: ${text.slice(0, 200)}`); }
    for (const m of Array.isArray(d) ? d : [d]) this.emit('message', m);
  }

  async close() {
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
    if (this.sessionId) {
      try { await fetch(this.url, { method: 'DELETE', headers: this.reqHeaders(), signal: AbortSignal.timeout(3000) }); } catch {}
      this.sessionId = null;
    }
    this.emit('close', { expected: true });
  }
}

// ---------------------------------------------------------------------------
// Cliente: handshake, listagem e chamada de ferramentas.
class McpClient extends EventEmitter {
  constructor(name, server, { root } = {}) {
    super();
    this.name = name;
    this.server = server;
    this.timeoutMs = (server.timeoutSec || 60) * 1000;
    this.transport = server.type === 'http'
      ? new HttpTransport({ url: server.url, headers: server.headers })
      : new StdioTransport({ command: server.command, args: server.args, env: server.env, cwd: root });
    this.nextId = 1;
    this.pending = new Map();
    this.tools = [];
    this.serverInfo = null;
    this.closed = false;
    this.transport.on('message', (m) => this.onMessage(m));
    this.transport.on('close', (info) => {
      const reason = info?.error || `processo encerrado (código ${info?.code ?? '?'}${info?.signal ? `, sinal ${info.signal}` : ''})`;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`Servidor MCP "${this.name}" ${reason}.${this.lastStderr()}`)); }
      this.pending.clear();
      if (!this.closed) { this.closed = true; this.emit('close', { ...info, reason }); }
    });
  }

  get stderr() { return this.transport.stderr; }
  lastStderr(n = 5) { const l = this.transport.stderr.slice(-n); return l.length ? `\n${l.join('\n')}` : ''; }

  onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.method && m.id !== undefined) return this.onServerRequest(m);
    if (m.method) {
      if (m.method === 'notifications/tools/list_changed') this.refreshTools().catch(() => {});
      else if (m.method === 'notifications/message') this.transport.pushStderr?.(`[log ${m.params?.level || ''}] ${typeof m.params?.data === 'string' ? m.params.data : JSON.stringify(m.params?.data)}`);
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) p.reject(rpcError(m.error));
    else p.resolve(m.result);
  }

  // Pedidos vindos do servidor: respondemos ping e roots; o resto não é suportado.
  onServerRequest(m) {
    let reply;
    if (m.method === 'ping') reply = { jsonrpc: '2.0', id: m.id, result: {} };
    else if (m.method === 'roots/list') reply = { jsonrpc: '2.0', id: m.id, result: { roots: [] } };
    else reply = { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Método não suportado pelo cliente: ${m.method}` } };
    try { this.transport.send(reply); } catch {}
  }

  request(method, params, { timeoutMs = this.timeoutMs, signal } = {}) {
    if (this.closed) return Promise.reject(new Error(`Servidor MCP "${this.name}" não está conectado.`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.pending.delete(id); clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
      const timer = setTimeout(() => {
        cleanup();
        this.notify('notifications/cancelled', { requestId: id, reason: 'timeout' });
        reject(new Error(`Tempo esgotado (${Math.round(timeoutMs / 1000)} s) em ${method} no servidor MCP "${this.name}".${this.lastStderr(3)}`));
      }, timeoutMs);
      const onAbort = () => {
        cleanup();
        this.notify('notifications/cancelled', { requestId: id, reason: 'Cancelado pelo usuário' });
        reject(Object.assign(new Error('Interrompido.'), { name: 'AbortError' }));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { resolve: (v) => { cleanup(); resolve(v); }, reject: (e) => { cleanup(); reject(e); }, timer });
      try { this.transport.send({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }); }
      catch (e) { cleanup(); reject(e); }
    });
  }

  notify(method, params) {
    try { this.transport.send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) }); } catch {}
  }

  async connect() {
    await this.transport.start();
    const init = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: false } },
      clientInfo: CLIENT_INFO,
    }, { timeoutMs: Math.max(this.timeoutMs, 60000) }); // npx/uvx podem demorar baixando o pacote
    this.serverInfo = init?.serverInfo || null;
    this.capabilities = init?.capabilities || {};
    this.instructions = init?.instructions || '';
    if (this.transport instanceof HttpTransport) this.transport.protocolVersion = init?.protocolVersion || PROTOCOL_VERSION;
    this.notify('notifications/initialized');
    await this.refreshTools();
    return this;
  }

  async refreshTools() {
    const all = [];
    let cursor;
    for (let page = 0; page < 50; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {});
      all.push(...(r?.tools || []));
      cursor = r?.nextCursor;
      if (!cursor) break;
    }
    this.tools = all.filter((t) => t && typeof t.name === 'string');
    this.emit('tools', this.tools);
    return this.tools;
  }

  callTool(name, args, { signal, timeoutMs } = {}) {
    return this.request('tools/call', { name, arguments: args || {} }, { signal, timeoutMs: timeoutMs || Math.max(this.timeoutMs, 300000) });
  }

  async close() {
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Conexão MCP encerrada.')); }
    this.pending.clear();
    await this.transport.close();
  }
}

// Converte o resultado de tools/call em texto para o modelo.
function contentToText(result) {
  const parts = [];
  for (const c of result?.content || []) {
    if (c.type === 'text') parts.push(c.text ?? '');
    else if (c.type === 'image' || c.type === 'audio') {
      const bytes = c.data ? Math.round((c.data.length * 3) / 4) : 0;
      parts.push(`[${c.type === 'image' ? 'imagem' : 'áudio'} ${c.mimeType || ''} de ~${bytes} bytes — conteúdo binário não exibido]`);
    } else if (c.type === 'resource') {
      const r = c.resource || {};
      if (typeof r.text === 'string') parts.push(`[recurso ${r.uri || ''}${r.mimeType ? ` (${r.mimeType})` : ''}]\n${r.text}`);
      else parts.push(`[recurso binário ${r.uri || ''}${r.mimeType ? ` (${r.mimeType})` : ''}]`);
    } else if (c.type === 'resource_link') {
      parts.push(`[link de recurso: ${c.name || ''} ${c.uri || ''}${c.description ? ` — ${c.description}` : ''}]`);
    } else parts.push(`[conteúdo ${c.type || 'desconhecido'}]`);
  }
  if (!parts.length && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2));
  return clip(parts.join('\n') || '(sem conteúdo)');
}

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

function cleanInputSchema(s) {
  const schema = s && typeof s === 'object' ? JSON.parse(JSON.stringify(s)) : {};
  delete schema.$schema;
  if (schema.type !== 'object') schema.type = 'object';
  if (!schema.properties || typeof schema.properties !== 'object') schema.properties = {};
  return schema;
}

// ---------------------------------------------------------------------------
// Gerenciador: um por servidor HTTP/projeto. Mantém as conexões em sincronia com a config.
class McpManager extends EventEmitter {
  constructor({ root, getConfig }) {
    super();
    this.root = root;
    this.getConfig = getConfig;
    this.entries = new Map(); // nome -> { server, sig, client, status, error, retries, timer }
    this.toolIndex = new Map(); // nome exposto -> { server, tool, trusted }
    this.stopped = false;
  }

  servers() { return this.getConfig()?.mcpServers || {}; }

  // Conecta/desconecta conforme a configuração atual. Não lança erros.
  sync() {
    if (this.stopped) return Promise.resolve();
    const wanted = this.servers();
    const jobs = [];
    for (const [name, e] of this.entries) {
      if (!wanted[name]) { jobs.push(this.disconnect(name)); this.entries.delete(name); }
    }
    for (const [name, server] of Object.entries(wanted)) {
      const sig = JSON.stringify(server);
      const e = this.entries.get(name);
      if (server.enabled === false) {
        if (e && e.status !== 'disabled') jobs.push(this.disconnect(name).then(() => { this.set(name, { status: 'disabled', error: '', server, sig }); }));
        else if (!e) this.set(name, { status: 'disabled', server, sig });
        else Object.assign(e, { server, sig });
        continue;
      }
      if (e && e.sig === sig && (e.status === 'connected' || e.status === 'connecting')) continue;
      jobs.push(this.connect(name, server));
    }
    return Promise.all(jobs).then(() => {});
  }

  set(name, patch) {
    const e = this.entries.get(name) || { status: 'disabled', error: '', retries: 0, tools: [] };
    Object.assign(e, patch);
    this.entries.set(name, e);
    this.rebuildIndex();
    this.emit('status', this.statusOf(name));
    return e;
  }

  async disconnect(name) {
    const e = this.entries.get(name);
    if (!e) return;
    clearTimeout(e.timer);
    const c = e.client;
    e.client = null;
    e.tools = [];
    if (c) { c.removeAllListeners('close'); await c.close().catch(() => {}); }
    this.rebuildIndex();
  }

  async connect(name, server) {
    await this.disconnect(name);
    if (this.stopped) return;
    const sig = JSON.stringify(server);
    const e = this.set(name, { server, sig, status: 'connecting', error: '', tools: [] });
    const client = new McpClient(name, server, { root: this.root });
    e.client = client;
    client.on('tools', (t) => { if (e.client === client) { e.tools = t; this.rebuildIndex(); } });
    client.on('close', (info) => {
      if (e.client !== client || this.stopped) return;
      e.client = null;
      e.stderr = client.stderr.slice();
      this.set(name, { status: 'error', error: `Servidor encerrou: ${info.reason}`, tools: [] });
      // Reinício automático com espera crescente (até 3 tentativas seguidas).
      if (e.wasConnected && e.retries < 3) {
        e.retries++;
        e.timer = setTimeout(() => { if (this.entries.get(name) === e && e.sig === sig && !this.stopped) this.connect(name, server); }, 1000 * 2 ** e.retries);
      }
    });
    try {
      await client.connect();
      if (e.client !== client) return;
      e.wasConnected = true;
      e.retries = 0;
      this.set(name, { status: 'connected', error: '', tools: client.tools, serverInfo: client.serverInfo, connectedAt: Date.now() });
    } catch (err) {
      if (e.client !== client) return;
      e.stderr = client.stderr.slice();
      e.client = null;
      client.removeAllListeners('close');
      await client.close().catch(() => {});
      this.set(name, { status: 'error', error: err.message, tools: [] });
    }
  }

  async restart(name) {
    const server = this.servers()[name];
    if (!server) throw Object.assign(new Error(`Servidor MCP "${name}" não existe.`), { status: 404 });
    const e = this.entries.get(name);
    if (e) e.retries = 0;
    if (server.enabled === false) { await this.disconnect(name); this.set(name, { status: 'disabled', server }); }
    else await this.connect(name, server);
    return this.statusOf(name);
  }

  // Testa uma configuração sem salvar: conecta, lista ferramentas e encerra.
  async test(name, server) {
    const client = new McpClient(name || 'teste', { ...server, timeoutSec: server.timeoutSec || 60 }, { root: this.root });
    const started = Date.now();
    try {
      await client.connect();
      return {
        ok: true, ms: Date.now() - started, serverInfo: client.serverInfo,
        tools: client.tools.map((t) => ({ name: t.name, description: t.description || '' })),
        stderr: client.stderr.slice(-10),
      };
    } catch (e) {
      return { ok: false, error: e.message, stderr: client.stderr.slice(-15) };
    } finally {
      client.removeAllListeners('close');
      await client.close().catch(() => {});
    }
  }

  statusOf(name) {
    const e = this.entries.get(name);
    const server = this.servers()[name] || e?.server || {};
    const stderr = (e?.client ? e.client.stderr : e?.stderr) || [];
    return {
      name,
      type: server.type || 'stdio',
      enabled: server.enabled !== false,
      trusted: !!server.trusted,
      status: e?.status || (server.enabled === false ? 'disabled' : 'connecting'),
      error: e?.error || '',
      serverInfo: e?.serverInfo || null,
      toolCount: e?.tools?.length || 0,
      tools: (e?.tools || []).map((t) => t.name),
      exposedTools: [...this.toolIndex.entries()].filter(([, v]) => v.server === name).map(([k]) => k),
      stderr: stderr.slice(-15),
    };
  }

  status() { return Object.keys(this.servers()).map((n) => this.statusOf(n)); }

  rebuildIndex() {
    this.toolIndex.clear();
    for (const [server, e] of this.entries) {
      if (e.status !== 'connected' || !e.client) continue;
      for (const t of e.tools || []) {
        let name = `mcp__${sanitize(server)}__${sanitize(t.name)}`.slice(0, 64);
        for (let n = 2; this.toolIndex.has(name); n++) name = `${name.slice(0, 64 - String(n).length - 1)}_${n}`;
        this.toolIndex.set(name, { server, tool: t, trusted: !!e.server?.trusted });
      }
    }
  }

  // Definições no mesmo formato de tools.DEFS.
  toolDefs() {
    return [...this.toolIndex.entries()].map(([name, { server, tool }]) => ({
      name,
      description: `[MCP: ${server}] ${tool.description || tool.title || tool.name}`.slice(0, 1024),
      parameters: cleanInputSchema(tool.inputSchema),
    }));
  }

  has(name) { return this.toolIndex.has(name); }
  isTrusted(name) { return !!this.toolIndex.get(name)?.trusted; }

  async callTool(name, args, { signal } = {}) {
    const ref = this.toolIndex.get(name);
    if (!ref) throw new Error(`Ferramenta MCP indisponível: ${name} (o servidor pode ter sido desconectado).`);
    const e = this.entries.get(ref.server);
    if (!e?.client) throw new Error(`Servidor MCP "${ref.server}" não está conectado.`);
    const result = await e.client.callTool(ref.tool.name, args, { signal });
    const text = contentToText(result);
    if (result?.isError) throw new Error(text);
    return text;
  }

  async closeAll() {
    this.stopped = true;
    await Promise.all([...this.entries.keys()].map((n) => this.disconnect(n)));
  }
}

module.exports = { McpClient, McpManager, contentToText, sanitize, PROTOCOL_VERSION };
