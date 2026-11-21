// Servidor HTTP local (sem dependências): API + interface web + eventos em tempo real (SSE).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('./config');
const tools = require('./tools');
const { AgentManager } = require('./agent');
const { getProvider } = require('./providers');
const { runCommand } = require('./proc');
const { friendlyError } = require('./providers/util');
const { buildRepoMap } = require('./repomap');
const openrouter = require('./openrouter');
const { McpManager } = require('./mcp');
const skills = require('./skills');
const { ProcessManager } = require('./proc');
const { realRoot } = require('./fsafe');
const { Friends } = require('./friends');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// Lista UMA pasta (a interface carrega as subpastas só quando você as abre).
const TREE_LIMIT = 3000;
async function listTree(root, rel) {
  const dir = tools.safePath(root, rel || '.');
  let entries = await fs.promises.readdir(dir, { withFileTypes: true });
  entries = entries
    .filter((e) => !tools.IGNORE.has(e.name) && e.name !== '.DS_Store')
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  const out = entries.slice(0, TREE_LIMIT).map((e) => {
    const p = path.relative(root, path.join(dir, e.name)).split(path.sep).join('/');
    return e.isDirectory() ? { name: e.name, path: p, dir: true } : { name: e.name, path: p };
  });
  if (entries.length > TREE_LIMIT) out.push({ name: `… mais ${entries.length - TREE_LIMIT} itens`, path: `${rel || ''}#more`, more: true });
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 20e6) reject(new Error('Corpo muito grande')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); } });
  });
}

function startServer({ root, port = 4747, host = '127.0.0.1' }) {
  let cfg = config.load();
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const mcp = new McpManager({ root, getConfig: () => cfg });
  const procs = new ProcessManager({ root, bus });
  // Confiança na pasta (Workspace Trust): sem ela, o modo autônomo vira "pedir antes de comandos"
  // e skills que vieram dentro do projeto são ignoradas.
  const trustKey = realRoot(root);
  const trusted = () => (cfg.trustedFolders || []).includes(trustKey);
  // MyFriends: hub local com sessões de outras IDEs (funciona mesmo com o LastGravity fechado).
  const friends = new Friends({ root, bus }).start();
  const manager = new AgentManager({ root, getConfig: () => cfg, bus, mcp, procs, trusted, friends });
  const clients = new Set();
  const broadcast = (type, data) => { const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(msg); };
  for (const t of ['agent', 'timeline', 'file', 'agent_removed', 'procs', 'friends']) bus.on(t, (d) => broadcast(t, d));
  bus.on('agent', (a) => friends.onAgent(a));
  bus.on('agent_removed', (d) => friends.onAgentRemoved(d.id));
  mcp.on('status', (d) => broadcast('mcp', d));
  const param = (s) => decodeURIComponent(s);

  const routes = [
    ['GET', /^\/api\/state$/, () => ({ root, name: path.basename(root), trusted: trusted(), hasProjectData: fs.existsSync(path.join(root, '.lastgravity')), config: config.masked(cfg), agents: manager.list(), procs: procs.list() })],
    ['POST', /^\/api\/trust$/, async (req) => {
      const b = await readBody(req);
      const list = new Set(cfg.trustedFolders || []);
      if (b.trusted) list.add(trustKey); else list.delete(trustKey);
      cfg = { ...cfg, trustedFolders: [...list] };
      config.save(cfg);
      for (const a of manager.agents.values()) bus.emit('agent', a.summary());
      return { trusted: trusted() };
    }],
    // Processos em segundo plano
    ['GET', /^\/api\/procs$/, () => procs.list()],
    ['POST', /^\/api\/procs$/, async (req) => { const b = await readBody(req); if (!b.command) throw Object.assign(new Error('Informe o comando.'), { status: 400 }); const p = procs.start(b.command, b); return { id: p.id }; }],
    ['GET', /^\/api\/procs\/(p\d+)\/log$/, (req, u, m) => ({ log: procs.read(m[1], 500) })],
    ['POST', /^\/api\/procs\/(p\d+)\/stop$/, (req, u, m) => { procs.stop(m[1]); return { ok: true }; }],
    ['GET', /^\/api\/tree$/, (req, u) => listTree(root, u.searchParams.get('path') || '')],
    ['GET', /^\/api\/file$/, (req, u) => {
      const abs = tools.safePath(root, u.searchParams.get('path'));
      if (fs.statSync(abs).size > 5e6) throw new Error('Arquivo grande demais para o editor.');
      const buf = fs.readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) throw new Error('Arquivo binário: não dá para abrir no editor.');
      return { path: u.searchParams.get('path'), content: buf.toString('utf8') };
    }],
    ['PUT', /^\/api\/file$/, async (req) => {
      const b = await readBody(req);
      const abs = tools.safePath(root, b.path, { write: true });
      if (typeof b.content !== 'string') throw Object.assign(new Error('Conteúdo inválido.'), { status: 400 });
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, b.content);
      bus.emit('file', { path: b.path, by: 'user' });
      return { ok: true };
    }],
    ['POST', /^\/api\/exec$/, async (req) => { const b = await readBody(req); const r = await runCommand(root, b.command, 300); bus.emit('file', { path: null }); return r; }],
    ['GET', /^\/api\/config$/, () => config.masked(cfg)],
    ['PUT', /^\/api\/config$/, async (req) => {
      cfg = config.update(cfg, await readBody(req));
      config.save(cfg);
      mcp.sync().catch(() => {}); // reconecta servidores MCP alterados em segundo plano
      return config.masked(cfg);
    }],
    // MCP
    ['GET', /^\/api\/mcp$/, () => ({ servers: mcp.status() })],
    ['POST', /^\/api\/mcp\/test$/, async (req) => {
      const b = await readBody(req);
      if (!b.server || typeof b.server !== 'object') throw Object.assign(new Error('Informe o servidor a testar.'), { status: 400 });
      const server = config.resolveMcpDraft(cfg, b.originalName || b.name, b.server);
      if (server.type === 'stdio' && !server.command) return { ok: false, error: 'Informe o comando.' };
      if (server.type === 'http' && !server.url) return { ok: false, error: 'Informe a URL.' };
      return mcp.test(b.name, server);
    }],
    ['POST', /^\/api\/mcp\/([^/]+)\/restart$/, (req, u, m) => mcp.restart(param(m[1]))],
    // Skills
    ['GET', /^\/api\/skills$/, () => ({ dirs: skills.dirs(root), skills: skills.list(root, cfg) })],
    ['POST', /^\/api\/skills$/, async (req) => skills.create(root, await readBody(req))],
    ['GET', /^\/api\/skills\/(global|project)\/([^/]+)$/, (req, u, m) => skills.read(root, m[1], param(m[2]))],
    ['PUT', /^\/api\/skills\/(global|project)\/([^/]+)$/, async (req, u, m) => skills.write(root, m[1], param(m[2]), (await readBody(req)).content)],
    ['DELETE', /^\/api\/skills\/(global|project)\/([^/]+)$/, (req, u, m) => skills.remove(root, m[1], param(m[2]))],
    ['POST', /^\/api\/providers\/test$/, async (req) => {
      const b = await readBody(req);
      const pcfg = config.resolveDraft(cfg, b.id, b.provider);
      const started = Date.now();
      try {
        const res = await getProvider(pcfg.type || 'openai').chat({
          cfg: pcfg, model: pcfg.model, system: 'Connection test. Reply with exactly: ok',
          messages: [{ role: 'user', content: 'Responda apenas: ok' }], tools: [], signal: AbortSignal.timeout(45000),
        });
        return { ok: true, ms: Date.now() - started, reply: (res.text || '').slice(0, 200) };
      } catch (e) { return { ok: false, error: e.name === 'TimeoutError' ? 'Tempo esgotado (45 s).' : friendlyError(e, pcfg.baseUrl) }; }
    }],
    ['POST', /^\/api\/providers\/models$/, async (req) => {
      const b = await readBody(req);
      const pcfg = config.resolveDraft(cfg, b.id, b.provider);
      try { return { ok: true, models: await getProvider(pcfg.type || 'openai').listModels(pcfg) }; }
      catch (e) { return { ok: false, error: friendlyError(e, pcfg.baseUrl) }; }
    }],
    // Catálogo do OpenRouter (busca, grátis/pago, preços por milhão de tokens)
    ['POST', /^\/api\/providers\/openrouter-models$/, async (req) => {
      const b = await readBody(req);
      const pcfg = config.resolveDraft(cfg, b.id || 'openrouter', b.provider);
      try { return { ok: true, ...(await openrouter.listModels(pcfg, { refresh: !!b.refresh })) }; }
      catch (e) { return { ok: false, error: e.message }; }
    }],
    // MyFriends
    ['GET', /^\/api\/friends$/, (req, u) => friends.state(u.searchParams.get('room') || '')],
    ['POST', /^\/api\/friends\/send$/, async (req) => friends.sendFromUser(await readBody(req))],
    ['GET', /^\/api\/friends\/targets$/, () => friends.targets()],
    ['POST', /^\/api\/friends\/install$/, async (req) => friends.install(await readBody(req))],
    ['GET', /^\/api\/repomap$/, () => ({ text: buildRepoMap(root) })],
    ['GET', /^\/api\/agents$/, () => manager.list()],
    ['PATCH', /^\/api\/agents\/([\w-]+)$/, async (req, u, m) => { manager.get(m[1]).update(await readBody(req)); return manager.get(m[1]).summary(); }],
    ['POST', /^\/api\/agents\/([\w-]+)\/fork$/, (req, u, m) => manager.fork(m[1]).full()],
    ['POST', /^\/api\/agents$/, async (req) => {
      const b = await readBody(req);
      if (!b.prompt?.trim() && !b.images?.length) throw Object.assign(new Error('Descreva a tarefa.'), { status: 400 });
      return manager.create(b).full();
    }],
    ['GET', /^\/api\/agents\/([\w-]+)$/, (req, u, m) => manager.get(m[1]).full()],
    ['DELETE', /^\/api\/agents\/([\w-]+)$/, (req, u, m) => { manager.remove(m[1]); return { ok: true }; }],
    ['POST', /^\/api\/agents\/([\w-]+)\/messages$/, async (req, u, m) => { const b = await readBody(req); await manager.get(m[1]).send(b.text, b.images); return { ok: true }; }],
    ['POST', /^\/api\/agents\/([\w-]+)\/approve$/, async (req, u, m) => { const b = await readBody(req); manager.get(m[1]).approve(b.callId, b.approved); return { ok: true }; }],
    ['POST', /^\/api\/agents\/([\w-]+)\/stop$/, (req, u, m) => { manager.get(m[1]).stop(); return { ok: true }; }],
    ['POST', /^\/api\/agents\/([\w-]+)\/undo$/, async (req, u, m) => { const b = await readBody(req); return manager.get(m[1]).undo({ force: !!b.force }); }],
    ['GET', /^\/api\/agents\/([\w-]+)\/diff$/, (req, u, m) => manager.get(m[1]).diff(u.searchParams.get('path'))],
  ];

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    // Proteção contra DNS rebinding: só aceita Host local.
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end('Host não permitido'); }

    if (u.pathname.startsWith('/api/')) {
      if (u.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': ok\n\n');
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      // Proteção CSRF: cabeçalho personalizado força preflight CORS, que nunca é aceito.
      if (req.method !== 'GET' && req.headers['x-lastgravity'] !== '1') { res.writeHead(403); return res.end('Cabeçalho ausente'); }
      for (const [method, re, handler] of routes) {
        const m = u.pathname.match(re);
        if (m && method === req.method) {
          try {
            const out = await handler(req, u, m);
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(out));
          } catch (e) {
            res.writeHead(e.status || (e.code === 'ENOENT' ? 404 : 500), { 'content-type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: e.message }));
          }
        }
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Rota não encontrada' }));
    }

    // Arquivos estáticos
    const file = path.join(PUBLIC, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Não encontrado'); }
    const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' };
    if (file.endsWith('.html')) {
      headers['content-security-policy'] = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' data: https://cdn.jsdelivr.net; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'self' vscode-webview:; base-uri 'none'; form-action 'none'; object-src 'none'";
      headers['referrer-policy'] = 'no-referrer';
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });

  server.on('close', () => { mcp.closeAll().catch(() => {}); procs.stopAll(); for (const a of manager.agents.values()) a.stop(); friends.stop(); });
  return new Promise((resolve) => server.listen(port, host, () => {
    mcp.sync().catch(() => {}); // conecta os servidores MCP habilitados
    resolve({ server, url: `http://localhost:${server.address().port}`, manager, mcp, procs, friends });
  }));
}

module.exports = { startServer };
