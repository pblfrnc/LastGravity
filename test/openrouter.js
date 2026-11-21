// Catálogo do OpenRouter: normalização (grátis/pago/variável, preço por milhão, ferramentas), rota e custo por modelo.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const CATALOG = { data: [
  { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder (free)', created: 1750000000, context_length: 262144, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools', 'temperature'], top_provider: {} },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', created: 1760000000, context_length: 1000000, pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools', 'reasoning'], top_provider: {} },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', created: 1740000000, context_length: 131072, pricing: { prompt: '0.00000027', completion: '0.0000011' }, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], top_provider: {} },
  { id: 'baidu/ernie-5.5-flash-preview:free', name: 'Ernie Flash (free)', created: 1763000000, context_length: 32768, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'] }, supported_parameters: ['temperature'], top_provider: {} },
  { id: 'openrouter/auto', name: 'Auto Router', created: 1700000000, context_length: 2000000, pricing: { prompt: '-1', completion: '-1' }, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], top_provider: {} },
] };

(async () => {
  let hits = 0, lastAuth = null;
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/api/v1/models')) { hits++; lastAuth = req.headers.authorization || null; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(CATALOG)); }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const fake = `http://127.0.0.1:${srv.address().port}/api/v1`;

  const or = require('../src/openrouter');
  const { models } = await or.listModels({ baseUrl: fake, apiKey: 'sk-or-x' });
  const by = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.strictEqual(lastAuth, 'Bearer sk-or-x');
  assert.strictEqual(by['qwen/qwen3-coder:free'].free, true);
  assert.strictEqual(by['qwen/qwen3-coder:free'].tools, true);
  assert.deepStrictEqual([by['anthropic/claude-sonnet-4.5'].priceIn, by['anthropic/claude-sonnet-4.5'].priceOut], [3, 15]);
  assert.strictEqual(by['anthropic/claude-sonnet-4.5'].vision, true);
  assert.strictEqual(by['deepseek/deepseek-chat'].priceIn, 0.27);
  assert.strictEqual(by['baidu/ernie-5.5-flash-preview:free'].tools, false);
  assert.strictEqual(by['openrouter/auto'].variable, true);
  assert.strictEqual(by['openrouter/auto'].priceIn, null);
  await or.listModels({ baseUrl: fake, apiKey: 'sk-or-x' });
  assert.strictEqual(hits, 1, 'segunda busca vem do cache');
  await or.listModels({ baseUrl: fake, apiKey: 'sk-or-x' }, { refresh: true });
  assert.strictEqual(hits, 2);
  console.log('✓ catálogo normalizado: grátis, pagos (US$/milhão), variável, ferramentas, imagens; cache');

  assert.deepStrictEqual(or.priceFor({ baseUrl: fake }, 'deepseek/deepseek-chat'), { priceIn: 0.27, priceOut: 1.1, free: false, tools: true });
  assert.strictEqual(or.priceFor({ baseUrl: fake }, 'openrouter/auto'), null);
  console.log('✓ preço por modelo para o custo dos agentes');

  // Rota da API (com chave mascarada vinda da interface)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgor-'));
  process.env.LASTGRAVITY_HOME = path.join(tmp, 'home');
  process.env.MYFRIENDS_HOME = path.join(tmp, 'friends');
  const { startServer } = require('../src/server');
  const { server, url } = await startServer({ root: tmp, port: 0 });
  const post = (p, body) => fetch(url + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-lastgravity': '1' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  await fetch(url + '/api/config', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-lastgravity': '1' }, body: JSON.stringify({ providers: { openrouter: { apiKey: 'sk-or-salva', baseUrl: fake } } }) });
  const cfg = await post('/api/config');
  const r = await post('/api/providers/openrouter-models', { id: 'openrouter', provider: cfg.providers.openrouter, refresh: true });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.models.length, 5);
  assert.strictEqual(lastAuth, 'Bearer sk-or-salva', 'chave mascarada resolvida para a chave salva');
  const bad = await post('/api/providers/openrouter-models', { id: 'openrouter', provider: { baseUrl: 'http://127.0.0.1:1/api/v1', apiKey: '' }, refresh: true });
  assert.strictEqual(bad.ok, false); assert.match(bad.error, /conectar/);
  console.log('✓ rota /api/providers/openrouter-models (chave salva, erro amigável)');

  server.close(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nOpenRouter OK.');
  process.exit(0);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
