// Testes de MCP (stdio + HTTP), skills e parâmetros de modelo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-mcp-'));
const ws = path.join(tmp, 'projeto'); fs.mkdirSync(ws);
fs.writeFileSync(path.join(ws, 'README.md'), '# demo\n');
process.env.LASTGRAVITY_HOME = path.join(tmp, 'home');
process.env.MYFRIENDS_HOME = path.join(tmp, 'friends');
const config = require('../src/config');
const { McpManager, contentToText } = require('../src/mcp');
const skills = require('../src/skills');
const { startServer } = require('../src/server');

const FAKE = path.join(__dirname, 'fixtures', 'fake-mcp.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeServer = (extra = {}) => ({ enabled: true, type: 'stdio', command: process.execPath, args: [FAKE], env: {}, trusted: false, ...extra });

// Servidor MCP "Streamable HTTP" falso: initialize em JSON, tools/list e tools/call em SSE.
function startHttpMcp() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
      const m = JSON.parse(body);
      seen.push({ method: m.method, session: req.headers['mcp-session-id'], auth: req.headers.authorization, version: req.headers['mcp-protocol-version'] });
      if (m.id === undefined) { res.writeHead(202); return res.end(); }
      if (m.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-42' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-fake', version: '1' } } }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const out = m.method === 'tools/list'
        ? { tools: [{ name: 'hora', description: 'Hora atual', inputSchema: { type: 'object', properties: {} } }] }
        : { content: [{ type: 'text', text: 'são 10h' }] };
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'log' } })}\n\n`);
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: out })}\n\n`);
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, url: `http://127.0.0.1:${srv.address().port}/mcp` })));
}

(async () => {
  // ---------- parâmetros de modelo ----------
  let c = config.update(config.load(), { modelParams: { temperature: '0.3', maxTokens: '8000', reasoningEffort: 'high' }, favoriteModels: [{ providerId: 'openai', model: 'gpt-5', label: 'GPT' }, { providerId: 'x' }] });
  assert.deepStrictEqual(c.modelParams, { temperature: 0.3, maxTokens: 8000, reasoningEffort: 'high' });
  assert.strictEqual(c.favoriteModels.length, 1);
  const oa = require('../src/providers/openai');
  const ge = require('../src/providers/gemini');
  assert.strictEqual(oa.applyParams({}, config.chatParams(config.load())).max_tokens, undefined, 'OpenAI não recebe max_tokens por padrão');
  assert.strictEqual(oa.applyParams({}, config.chatParams(config.load())).temperature, undefined);
  assert.deepStrictEqual(oa.applyParams({}, config.chatParams(c)), { temperature: 0.3, max_tokens: 8000, reasoning_effort: 'high' });
  assert.deepStrictEqual(ge.generationConfig(config.chatParams(c)), { temperature: 0.3, maxOutputTokens: 8000 });
  assert.strictEqual(ge.generationConfig(config.chatParams(config.load())), null);
  const gs = ge.geminiSchema({ $schema: 'x', type: 'object', additionalProperties: false, properties: { default: { type: 'string', default: 'a' } } });
  assert.deepStrictEqual(gs, { type: 'object', properties: { default: { type: 'string' } } });
  console.log('✓ parâmetros de modelo e favoritos');

  // ---------- gerenciador MCP direto (stdio) ----------
  let mcpCfg = { mcpServers: { fake: fakeServer(), desligado: fakeServer({ enabled: false }) } };
  const mgr = new McpManager({ root: ws, getConfig: () => mcpCfg });
  await mgr.sync();
  let st = mgr.status();
  const fs1 = st.find((s) => s.name === 'fake');
  assert.strictEqual(fs1.status, 'connected', JSON.stringify(fs1));
  assert.strictEqual(fs1.toolCount, 3, 'paginação de tools/list');
  assert.ok(fs1.stderr.some((l) => l.includes('fake-mcp iniciado')), 'guarda stderr');
  assert.strictEqual(st.find((s) => s.name === 'desligado').status, 'disabled');
  const defs = mgr.toolDefs();
  assert.deepStrictEqual(defs.map((d) => d.name).sort(), ['mcp__fake__echo', 'mcp__fake__falha', 'mcp__fake__soma']);
  assert.ok(!('$schema' in defs.find((d) => d.name === 'mcp__fake__echo').parameters));
  const out = await mgr.callTool('mcp__fake__echo', { text: 'oi' });
  assert.ok(out.includes('eco: oi') && out.includes('[imagem image/png'), out);
  assert.strictEqual(await mgr.callTool('mcp__fake__soma', { a: 2, b: 3 }), '5');
  await assert.rejects(mgr.callTool('mcp__fake__falha', {}), /deu errado/);
  await mgr.restart('fake');
  assert.strictEqual(mgr.statusOf('fake').status, 'connected');
  // Desligar pela config desconecta e remove as ferramentas.
  mcpCfg = { mcpServers: { fake: fakeServer({ enabled: false }) } };
  await mgr.sync();
  assert.strictEqual(mgr.statusOf('fake').status, 'disabled');
  assert.strictEqual(mgr.toolDefs().length, 0);
  // Comando inexistente gera erro legível.
  const bad = await mgr.test('ruim', { type: 'stdio', command: 'comando-que-nao-existe-lg', args: [] });
  assert.ok(!bad.ok && /não encontrado|ENOENT|not found/i.test(bad.error + bad.stderr.join(' ')), JSON.stringify(bad));
  await mgr.closeAll();
  assert.strictEqual(contentToText({ content: [{ type: 'resource', resource: { uri: 'file:///a', text: 'abc' } }] }), '[recurso file:///a]\nabc');
  console.log('✓ MCP stdio: conectar, paginação, chamar, erro, reiniciar, desligar');

  // ---------- MCP via HTTP (Streamable HTTP) ----------
  const hm = await startHttpMcp();
  const mgr2 = new McpManager({ root: ws, getConfig: () => ({ mcpServers: { web: { enabled: true, type: 'http', url: hm.url, headers: { Authorization: 'Bearer abc' } } } }) });
  await mgr2.sync();
  assert.strictEqual(mgr2.statusOf('web').status, 'connected', JSON.stringify(mgr2.statusOf('web')));
  assert.strictEqual(await mgr2.callTool('mcp__web__hora', {}), 'são 10h');
  const listReq = hm.seen.find((s) => s.method === 'tools/list');
  assert.strictEqual(listReq.session, 'sess-42', 'reenvia Mcp-Session-Id');
  assert.strictEqual(listReq.auth, 'Bearer abc');
  assert.strictEqual(listReq.version, '2025-06-18');
  assert.ok(hm.seen.some((s) => s.method === 'notifications/initialized'));
  await mgr2.closeAll();
  hm.srv.close();
  console.log('✓ MCP HTTP: JSON + SSE, sessão e cabeçalhos');

  // ---------- servidor completo ----------
  const { server, url } = await startServer({ root: ws, port: 0 });
  const api = async (p, opts = {}) => {
    const r = await fetch(url + p, { ...opts, headers: { 'content-type': 'application/json', 'x-lastgravity': '1' }, body: opts.body && JSON.stringify(opts.body) });
    const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status }); return j;
  };
  const waitFor = async (id, pred, label) => { for (let i = 0; i < 100; i++) { const a = await api(`/api/agents/${id}`); if (pred(a)) return a; await sleep(100); } throw new Error('timeout: ' + label); };
  const waitMcp = async (name, status) => { for (let i = 0; i < 100; i++) { const s = (await api('/api/mcp')).servers.find((x) => x.name === name); if (s?.status === status) return s; await sleep(100); } throw new Error(`timeout mcp ${name} ${status}`); };

  // Segredos de MCP: mascarados na resposta, preservados no arquivo e em updates.
  const SECRET = 'sk-segredo-abcdef123456';
  let cfgRes = await api('/api/config', { method: 'PUT', body: { mcpServers: { fake: fakeServer({ env: { FAKE_MCP_TOKEN: SECRET, MODO: 'teste' } }) } } });
  assert.ok(cfgRes.mcpServers.fake.env.FAKE_MCP_TOKEN.startsWith(config.MASK) && !cfgRes.mcpServers.fake.env.FAKE_MCP_TOKEN.includes('segredo'));
  assert.strictEqual(cfgRes.mcpServers.fake.env.MODO, 'teste', 'valores comuns não são mascarados');
  const savedPath = path.join(process.env.LASTGRAVITY_HOME, 'config.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(savedPath, 'utf8')).mcpServers.fake.env.FAKE_MCP_TOKEN, SECRET);
  // A UI devolve o rascunho inteiro (com máscara): o segredo continua o mesmo.
  const draft = JSON.parse(JSON.stringify(cfgRes));
  draft.mcpServers.fake.args = [FAKE, '--x'];
  cfgRes = await api('/api/config', { method: 'PUT', body: draft });
  let saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
  assert.strictEqual(saved.mcpServers.fake.env.FAKE_MCP_TOKEN, SECRET, 'máscara preserva o segredo');
  assert.deepStrictEqual(saved.mcpServers.fake.args, [FAKE, '--x']);
  assert.strictEqual(saved.providers.anthropic.apiKey, '', 'chave de provedor vazia continua vazia');
  // Renomear o servidor no rascunho também preserva o segredo.
  const d2 = JSON.parse(JSON.stringify(cfgRes));
  d2.mcpServers = { eco: { ...d2.mcpServers.fake, args: [FAKE] } };
  cfgRes = await api('/api/config', { method: 'PUT', body: d2 });
  saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
  assert.deepStrictEqual(Object.keys(saved.mcpServers), ['eco']);
  assert.strictEqual(saved.mcpServers.eco.env.FAKE_MCP_TOKEN, SECRET, 'renomear preserva o segredo');
  console.log('✓ PUT /api/config com mcpServers mascara e preserva segredos');

  let s = await waitMcp('eco', 'connected');
  assert.strictEqual(s.toolCount, 3);
  assert.ok(s.stderr.some((l) => l.includes(`token recebido (${SECRET.length} caracteres)`)), 'env real chega ao processo');
  const t = await api('/api/mcp/test', { method: 'POST', body: { name: 'eco', server: cfgRes.mcpServers.eco } });
  assert.ok(t.ok && t.tools.some((x) => x.name === 'echo'), JSON.stringify(t));
  assert.ok(t.stderr.some((l) => l.includes(`token recebido (${SECRET.length}`)), 'teste resolve segredo mascarado');
  const t2 = await api('/api/mcp/test', { method: 'POST', body: { name: 'x', server: { type: 'stdio', command: '' } } });
  assert.ok(!t2.ok);
  s = await api('/api/mcp/eco/restart', { method: 'POST' });
  assert.strictEqual(s.status, 'connected');
  console.log('✓ rotas /api/mcp, /api/mcp/test e restart');

  // Agente (mock) chamando ferramenta MCP: pede aprovação (servidor não confiável) em ask-commands.
  let a = await api('/api/agents', { method: 'POST', body: { prompt: 'mcp: olá mundo', providerId: 'mock', approval: 'ask-commands' } });
  const w = await waitFor(a.id, (x) => x.status === 'awaiting_approval', 'aprovação mcp');
  const pend = w.timeline.find((x) => x.state === 'awaiting_approval');
  assert.strictEqual(pend.name, 'mcp__eco__echo');
  await api(`/api/agents/${a.id}/approve`, { method: 'POST', body: { callId: pend.callId, approved: true } });
  let done = await waitFor(a.id, (x) => x.status === 'done', 'conclusão mcp');
  assert.ok(done.timeline.some((x) => x.kind === 'assistant' && x.text.includes('eco: olá mundo')), 'resposta usa saída MCP');
  // Servidor confiável: não pede aprovação.
  const d3 = JSON.parse(JSON.stringify(cfgRes)); d3.mcpServers.eco.trusted = true;
  cfgRes = await api('/api/config', { method: 'PUT', body: d3 });
  await waitMcp('eco', 'connected');
  for (let i = 0; i < 50 && !(await api('/api/mcp')).servers[0].trusted; i++) await sleep(50);
  await sleep(300);
  a = await api('/api/agents', { method: 'POST', body: { prompt: 'mcp: confiável', providerId: 'mock', approval: 'ask-commands' } });
  done = await waitFor(a.id, (x) => x.status === 'done' || x.status === 'awaiting_approval', 'conclusão mcp confiável');
  assert.strictEqual(done.status, 'done', 'servidor confiável não pede aprovação');
  assert.ok(done.timeline.some((x) => x.name === 'mcp__eco__echo' && x.output.includes('eco: confiável')));
  const tools = require('../src/tools');
  assert.strictEqual(tools.needsApproval('auto', 'mcp__x__y'), false);
  assert.strictEqual(tools.needsApproval('ask-all', 'mcp__x__y'), true);
  assert.strictEqual(tools.needsApproval('ask-all', 'mcp__x__y', { trusted: true }), false);
  assert.strictEqual(tools.needsApproval('ask-all', 'use_skill'), false);
  console.log('✓ agente usa ferramenta MCP (aprovação e servidor confiável)');

  // ---------- skills ----------
  await assert.rejects(api('/api/skills', { method: 'POST', body: { name: 'Nome Ruim', description: 'x', scope: 'project' } }), (e) => e.status === 400);
  const sk = await api('/api/skills', { method: 'POST', body: { name: 'revisar-codigo', description: 'Use ao revisar código: checklist de revisão.', body: '# Revisão\nSempre verifique os testes.', scope: 'project' } });
  assert.strictEqual(sk.scope, 'project');
  await api('/api/skills', { method: 'POST', body: { name: 'estilo-global', description: 'Guia: estilo "global" da casa', body: 'Use aspas simples.', scope: 'global' } });
  await assert.rejects(api('/api/skills', { method: 'POST', body: { name: 'revisar-codigo', description: 'dup', scope: 'project' } }), (e) => e.status === 409);
  const gdir = path.join(process.env.LASTGRAVITY_HOME, 'skills', 'estilo-global');
  fs.mkdirSync(path.join(gdir, 'refs')); fs.writeFileSync(path.join(gdir, 'refs', 'exemplo.md'), 'exemplo de apoio');
  fs.writeFileSync(path.join(process.env.LASTGRAVITY_HOME, 'fora.txt'), 'não deveria ler');
  let list = await api('/api/skills');
  assert.ok(list.dirs.global && list.dirs.project);
  assert.ok(list.skills.some((x) => x.name === 'myfriends' && x.scope === 'global'), 'MyFriends vem instalada por padrão');
  list.skills = list.skills.filter((x) => x.name !== 'myfriends');
  assert.deepStrictEqual(list.skills.map((x) => [x.name, x.scope, x.active]), [['estilo-global', 'global', true], ['revisar-codigo', 'project', true]]);
  assert.strictEqual(list.skills[0].description, 'Guia: estilo "global" da casa', 'frontmatter com aspas');
  // parser de frontmatter
  const fm = skills.parseFrontmatter('---\nname: x\ndescription: >\n  linha um\n  linha dois\nmetadata:\n  a: b\n---\ncorpo');
  assert.deepStrictEqual([fm.data.name, fm.data.description, fm.body], ['x', 'linha um linha dois', 'corpo']);

  // use_skill direto
  const cfgNow = config.load();
  let us = skills.useSkill(ws, cfgNow, { name: 'estilo-global' });
  assert.ok(us.includes('Use aspas simples.') && us.includes('refs/exemplo.md'));
  assert.strictEqual(skills.useSkill(ws, cfgNow, { name: 'estilo-global', file: 'refs/exemplo.md' }), 'exemplo de apoio');
  assert.throws(() => skills.useSkill(ws, cfgNow, { name: 'estilo-global', file: '../../fora.txt' }), /fora da pasta/);
  assert.throws(() => skills.useSkill(ws, cfgNow, { name: 'estilo-global', file: path.join(process.env.LASTGRAVITY_HOME, 'fora.txt') }), /fora da pasta/);
  assert.ok(skills.promptSection(ws, cfgNow).includes('- revisar-codigo: Use ao revisar código'));

  // Pasta não confiável: skills que vieram dentro do projeto são ignoradas
  assert.ok(!skills.promptSection(ws, cfgNow, { includeProject: false }).includes('revisar-codigo'));
  assert.ok(skills.promptSection(ws, cfgNow, { includeProject: false }).includes('estilo-global'));
  assert.strictEqual((await api('/api/state')).trusted, false);
  assert.strictEqual((await api('/api/trust', { method: 'POST', body: { trusted: true } })).trusted, true);

  // use_skill via agente mock (sem aprovação), depois de confiar na pasta
  a = await api('/api/agents', { method: 'POST', body: { prompt: 'skill: revisar-codigo', providerId: 'mock', approval: 'ask-all' } });
  done = await waitFor(a.id, (x) => x.status === 'done' || x.status === 'awaiting_approval', 'skill via agente');
  assert.strictEqual(done.status, 'done');
  assert.ok(done.timeline.some((x) => x.name === 'use_skill' && x.output.includes('Sempre verifique os testes.')));

  // conteúdo: ler e salvar
  const content = await api('/api/skills/project/revisar-codigo');
  assert.ok(content.content.startsWith('---\nname: revisar-codigo'));
  await api('/api/skills/project/revisar-codigo', { method: 'PUT', body: { content: content.content.replace('Sempre verifique os testes.', 'Verifique tudo.') } });
  await assert.rejects(api('/api/skills/project/revisar-codigo', { method: 'PUT', body: { content: 'sem frontmatter' } }), (e) => e.status === 400);
  await assert.rejects(api('/api/skills/project/..%2F..%2Fx'), (e) => e.status === 400);
  assert.ok(skills.useSkill(ws, config.load(), { name: 'revisar-codigo' }).includes('Verifique tudo.'));

  // desativar
  cfgRes = await api('/api/config', { method: 'PUT', body: { skills: { disabled: ['revisar-codigo'] } } });
  assert.deepStrictEqual(cfgRes.skills.disabled, ['revisar-codigo']);
  list = await api('/api/skills');
  assert.strictEqual(list.skills.find((x) => x.name === 'revisar-codigo').active, false);
  assert.throws(() => skills.useSkill(ws, config.load(), { name: 'revisar-codigo' }), /desativada/);
  assert.ok(!skills.promptSection(ws, config.load()).includes('revisar-codigo'));
  assert.strictEqual(JSON.parse(fs.readFileSync(savedPath, 'utf8')).mcpServers.eco.env.FAKE_MCP_TOKEN, SECRET, 'update parcial mantém MCP');

  // excluir
  await api('/api/skills/global/estilo-global', { method: 'DELETE' });
  assert.ok(!fs.existsSync(gdir));
  list = await api('/api/skills');
  assert.deepStrictEqual(list.skills.map((x) => x.name).filter((n) => n !== 'myfriends'), ['revisar-codigo']);
  console.log('✓ skills: criar, listar, use_skill (com arquivos de apoio), editar, desativar, excluir');

  // remover servidor MCP pela config desconecta
  await api('/api/config', { method: 'PUT', body: { mcpServers: {} } });
  await sleep(200);
  assert.deepStrictEqual((await api('/api/mcp')).servers, []);
  console.log('✓ remover servidor MCP da config');

  server.closeAllConnections?.();
  server.close();
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nTestes de MCP/skills passaram.');
  process.exit(0);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
