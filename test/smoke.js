// Teste de fumaça: sobe o servidor, roda um agente simulado de ponta a ponta.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-'));
const ws = path.join(tmp, 'projeto'); fs.mkdirSync(ws);
fs.writeFileSync(path.join(ws, 'README.md'), '# demo\n');
process.env.LASTGRAVITY_HOME = path.join(tmp, 'home');
process.env.MYFRIENDS_HOME = path.join(tmp, 'friends');
const { startServer } = require('../src/server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { server, url } = await startServer({ root: ws, port: 0 });
  const api = async (p, opts = {}) => {
    const r = await fetch(url + p, { ...opts, headers: { 'content-type': 'application/json', 'x-lastgravity': '1' }, body: opts.body && JSON.stringify(opts.body) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error); return j;
  };
  const waitFor = async (id, pred, label) => { for (let i = 0; i < 100; i++) { const a = await api(`/api/agents/${id}`); if (pred(a)) return a; await sleep(100); } throw new Error('timeout: ' + label); };

  // segurança
  let r = await fetch(url + '/api/agents', { method: 'POST', body: '{}' });
  assert.strictEqual(r.status, 403, 'POST sem cabeçalho deve ser bloqueado');
  r = await fetch(url + '/api/file?path=../../etc/passwd');
  assert.notStrictEqual(r.status, 200, 'path traversal deve falhar');
  console.log('✓ segurança (CSRF + path traversal)');

  // estático + estado
  r = await fetch(url + '/'); assert.ok((await r.text()).includes('LastGravity'));
  const st = await api('/api/state'); assert.ok(st.config.providers.anthropic);
  const tree = await api('/api/tree'); assert.ok(tree.find((n) => n.name === 'README.md'));
  console.log('✓ UI, estado e árvore');

  // agente simulado com aprovação de comando
  const a = await api('/api/agents', { method: 'POST', body: { prompt: 'crie um hello', providerId: 'mock', approval: 'ask-commands' } });
  const waiting = await waitFor(a.id, (x) => x.status === 'awaiting_approval', 'aprovação');
  assert.ok(fs.existsSync(path.join(ws, 'hello.txt')), 'hello.txt criado antes do comando');
  const call = waiting.timeline.find((t) => t.state === 'awaiting_approval');
  assert.strictEqual(call.name, 'run_command');
  await api(`/api/agents/${a.id}/approve`, { method: 'POST', body: { callId: call.callId, approved: true } });
  const done = await waitFor(a.id, (x) => x.status === 'done', 'conclusão');
  assert.strictEqual(done.plan.length, 3);
  assert.ok(done.timeline.some((t) => t.name === 'run_command' && t.output.includes('Olá do LastGravity')));
  assert.deepStrictEqual(done.changedFiles, ['hello.txt']);
  console.log('✓ agente: plano → ferramentas → aprovação → comando → resumo');

  const d = await api(`/api/agents/${a.id}/diff?path=hello.txt`);
  assert.strictEqual(d.original, ''); assert.ok(d.current.includes('Olá'));
  await api(`/api/agents/${a.id}/undo`, { method: 'POST' });
  assert.ok(!fs.existsSync(path.join(ws, 'hello.txt')), 'desfazer remove arquivo criado');
  console.log('✓ diff e desfazer');

  // continuação da conversa + persistência
  await api(`/api/agents/${a.id}/messages`, { method: 'POST', body: { text: 'de novo' } });
  const w2 = await waitFor(a.id, (x) => x.status === 'awaiting_approval', 'aprovação 2');
  await api(`/api/agents/${a.id}/approve`, { method: 'POST', body: { callId: w2.timeline.filter((t) => t.state === 'awaiting_approval').pop().callId, approved: false } });
  const d2 = await waitFor(a.id, (x) => x.status === 'done', 'conclusão 2');
  assert.ok(d2.timeline.some((t) => t.state === 'rejected'));
  assert.ok(fs.existsSync(path.join(ws, '.lastgravity', 'agents', `${a.id}.json`)));
  console.log('✓ segunda mensagem, rejeição e persistência');

  // terminal e config
  const ex = await api('/api/exec', { method: 'POST', body: { command: 'echo oi' } });
  assert.ok(ex.output.includes('oi'));
  const cfg = await api('/api/config', { method: 'PUT', body: { providers: { anthropic: { apiKey: 'sk-test-1234' } } } });
  assert.ok(cfg.providers.anthropic.apiKey.endsWith('1234') && !cfg.providers.anthropic.apiKey.includes('sk-test'));
  const cfg2 = await api('/api/config', { method: 'PUT', body: { providers: { anthropic: { apiKey: cfg.providers.anthropic.apiKey, model: 'x' } } } });
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.LASTGRAVITY_HOME, 'config.json'), 'utf8'));
  assert.strictEqual(saved.providers.anthropic.apiKey, 'sk-test-1234', 'chave mascarada não sobrescreve');
  console.log('✓ terminal e configurações (chave mascarada preservada)');

  // conversores de provedores
  const msgs = [
    { role: 'user', content: 'oi' },
    { role: 'assistant', text: 'vou ler', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a' } }] },
    { role: 'tool', results: [{ id: 'c1', name: 'read_file', output: 'conteúdo' }] },
    { role: 'user', content: 'e agora?' },
  ];
  const an = require('../src/providers/anthropic').convert(msgs);
  assert.deepStrictEqual(an.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.strictEqual(an[2].content[0].type, 'tool_result');
  const oa = require('../src/providers/openai').convert('sys', msgs);
  assert.deepStrictEqual(oa.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'user']);
  const ge = require('../src/providers/gemini').convert(msgs);
  assert.deepStrictEqual(ge.map((m) => m.role), ['user', 'model', 'user']);
  assert.ok(ge[2].parts[0].functionResponse && ge[2].parts[1].text);
  console.log('✓ conversores Anthropic / OpenAI / Gemini');

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nTodos os testes passaram.');
  process.exit(0);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
