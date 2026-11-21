// Testes do MyFriends: hub entre processos (CLI), long-poll, tarefas sem duplicar, limpeza de sessões,
// blobs, permissões, rotas do servidor, instalação nas IDEs (HOME falso) e agente mock com friends_*.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn, spawnSync, execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-friends-'));
const ws = path.join(tmp, 'meu-projeto'); fs.mkdirSync(ws);
fs.writeFileSync(path.join(ws, 'README.md'), '# demo\nlinha 2\nlinha 3\n');
fs.writeFileSync(path.join(ws, '.env'), 'SEGREDO=1\n');
const fakeHome = path.join(tmp, 'home-falso'); fs.mkdirSync(fakeHome);
// Nada deste teste pode tocar o HOME real.
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
process.env.MYFRIENDS_HOME = path.join(tmp, 'hub');
process.env.LASTGRAVITY_HOME = path.join(tmp, 'lg-home');
process.env.MYFRIENDS_NO_PATH_DETECT = '1';
delete process.env.CLAUDECODE;
delete process.env.MYFRIENDS_SESSION;

const CLI = path.join(__dirname, '..', 'skills', 'myfriends', 'scripts', 'myfriends.js');
const H = require('../skills/myfriends/scripts/hub');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env };

function mf(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd || ws, env, encoding: 'utf8', timeout: 30000 });
  if (opts.json) {
    const j = JSON.parse(r.stdout || '{}');
    if (!opts.allowError) assert.ok(!j.error, `${args.join(' ')} → ${j.error}`);
    return j;
  }
  return r;
}
function mfAsync(args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, ...args], { cwd: ws, env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
}

(async () => {
  const hub = new H.Hub();

  // ---------- duas sessões em processos separados ----------
  const a = mf(['join', '--name', 'Claude Code · meu-projeto', '--tool', 'claude', '--json'], { json: true }).session;
  const b = mf(['join', '--tool', 'codex', '--json'], { json: true }).session;
  assert.ok(/^s_/.test(a.id) && /^s_/.test(b.id) && a.id !== b.id);
  assert.strictEqual(a.room, b.room, 'mesma sala padrão para o mesmo projeto');
  assert.strictEqual(a.room, H.projectRoom(ws));
  assert.ok(a.room.startsWith('meu-projeto-'));
  assert.strictEqual(b.name, 'Codex · meu-projeto', 'nome padrão');
  // join --session volta para a mesma sessão (join sem --session cria uma nova: uma por janela)
  assert.strictEqual(mf(['join', '--tool', 'claude', '--session', a.id, '--json'], { json: true }).session.id, a.id);
  const who = mf(['who', '--tool', 'codex', '--json'], { json: true });
  assert.deepStrictEqual(who.sessions.map((s) => s.id).sort(), [a.id, b.id].sort());
  assert.ok(mf(['who', '--tool', 'codex']).stdout.includes('mesma sala'));

  mf(['send', 'oi Codex, pode revisar o README?', '--tool', 'claude']);
  let r = mf(['read', '--tool', 'codex', '--json'], { json: true });
  assert.strictEqual(r.messages.length, 1);
  assert.strictEqual(r.messages[0].text, 'oi Codex, pode revisar o README?');
  assert.strictEqual(r.messages[0].fromName, 'Claude Code · meu-projeto');
  assert.strictEqual(mf(['read', '--tool', 'codex', '--json'], { json: true }).messages.length, 0, 'cursor: não repete mensagens lidas');
  assert.strictEqual(mf(['read', '--tool', 'claude', '--json'], { json: true }).messages.length, 0, 'não recebe as próprias mensagens');
  assert.strictEqual(mf(['read', '--tool', 'codex', '--since', '5m', '--json'], { json: true }).messages.length, 1, '--since por tempo');
  // mensagem direta: só o destinatário vê (sem --all)
  const c = mf(['join', '--tool', 'antigravity', '--json'], { json: true }).session;
  mf(['send', 'só para o codex', '--to', 'codex', '--tool', 'claude']);
  assert.strictEqual(mf(['read', '--tool', 'codex', '--json'], { json: true }).messages[0].to, b.id);
  assert.strictEqual(mf(['read', '--tool', 'antigravity', '--json'], { json: true }).messages.filter((m) => m.text === 'só para o codex').length, 0);
  assert.strictEqual(mf(['status', 'revisando README', '--tool', 'codex', '--json'], { json: true }).session.doing, 'revisando README');
  console.log('✓ duas sessões (processos separados): join, who, send, read com cursor, --since, mensagem direta, status');

  // ---------- long-poll ----------
  const t0 = Date.now();
  const waiting = mfAsync(['read', '--wait', '15', '--tool', 'codex', '--json']);
  await sleep(700);
  mf(['send', 'ping do long-poll', '--tool', 'claude']);
  const lp = await waiting;
  const lpj = JSON.parse(lp.out);
  assert.ok(lpj.messages.some((m) => m.text === 'ping do long-poll'), lp.out);
  assert.ok(Date.now() - t0 < 8000, 'long-poll acordou logo após a mensagem');
  const t1 = Date.now();
  assert.strictEqual(mf(['read', '--wait', '1', '--tool', 'codex', '--json'], { json: true }).messages.length, 0);
  assert.ok(Date.now() - t1 >= 900, 'espera o tempo pedido quando não há nada');
  console.log('✓ long-poll (--wait) acorda com mensagem nova e respeita o tempo limite');

  // ---------- tarefas: claim/done sem duplicar ----------
  const task = mf(['send', 'escrever testes do parser', '--type', 'task', '--tool', 'antigravity', '--json'], { json: true }).message;
  const [ca, cb] = await Promise.all([mfAsync(['claim', task.id, '--tool', 'claude', '--json']), mfAsync(['claim', task.id, '--tool', 'codex', '--json'])]);
  const ok = [ca, cb].filter((x) => x.code === 0);
  const fail = [ca, cb].filter((x) => x.code !== 0);
  assert.strictEqual(ok.length, 1, `só uma sessão pega a tarefa: ${ca.out} | ${cb.out}`);
  assert.strictEqual(fail.length, 1);
  assert.ok(/já foi pega/.test(JSON.parse(fail[0].out).error));
  const winnerTool = ca.code === 0 ? 'claude' : 'codex';
  const loserTool = winnerTool === 'claude' ? 'codex' : 'claude';
  assert.ok(/já foi pega|está com/.test(mf(['done', task.id, 'eu fiz', '--tool', loserTool, '--json'], { json: true, allowError: true }).error), 'só quem pegou conclui');
  mf(['done', task.id, 'testes criados em test/parser.js', '--tool', winnerTool]);
  let board = mf(['tasks', '--tool', 'antigravity', '--json'], { json: true });
  const tk = board.tasks.find((t) => t.id === task.id);
  assert.strictEqual(tk.status, 'done');
  assert.strictEqual(tk.result, 'testes criados em test/parser.js');
  assert.ok(/concluída/.test(mf(['claim', task.id, '--tool', 'antigravity', '--json'], { json: true, allowError: true }).error));
  // a conclusão é avisada a quem pediu
  assert.ok(mf(['read', '--tool', 'antigravity', '--json'], { json: true }).messages.some((m) => m.type === 'done' && m.ref === task.id));
  // reserva de arquivos
  const res = mf(['claim', '--files', 'src/a.js,src/b.js', '--tool', 'claude', '--json'], { json: true }).message;
  assert.ok(/reservados por outra sessão/.test(mf(['claim', '--files', 'src/b.js', '--tool', 'codex', '--json'], { json: true, allowError: true }).error));
  mf(['done', res.id, 'liberado', '--tool', 'claude']);
  mf(['claim', '--files', 'src/b.js', '--tool', 'codex']);
  board = mf(['tasks', '--tool', 'codex', '--json'], { json: true });
  assert.deepStrictEqual(board.claims.map((x) => x.files), [['src/b.js']]);
  console.log('✓ fila de tarefas: claim concorrente sem duplicar, done só por quem pegou, reserva de arquivos');

  // ---------- limpeza de sessões mortas ----------
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  const deadPid = Number(dead.stdout);
  const d1 = hub.join({ name: 'Processo morto', tool: 'outro', folder: ws, pid: deadPid });
  const d2 = hub.join({ name: 'Sumido', tool: 'outro', folder: ws });
  const f2 = path.join(process.env.MYFRIENDS_HOME, 'sessions', `${d2.id}.json`);
  const old = JSON.parse(fs.readFileSync(f2, 'utf8')); old.lastSeen = Date.now() - 11 * 60 * 1000; fs.writeFileSync(f2, JSON.stringify(old));
  const ids = mf(['who', '--all', '--tool', 'claude', '--json'], { json: true }).sessions.map((s) => s.id);
  assert.ok(!ids.includes(d1.id) && !ids.includes(d2.id), 'sessões mortas somem');
  assert.ok(!fs.existsSync(f2) && !fs.existsSync(path.join(process.env.MYFRIENDS_HOME, 'sessions', `${d1.id}.json`)), 'arquivos apagados');
  console.log('✓ limpeza de sessões mortas (pid inexistente e lastSeen > 10 min)');

  // ---------- mensagens grandes em blob + segredos ----------
  const big = `INICIO ${'x'.repeat(20000)} FIM`;
  const bm = mf(['share', '--summary', big, '--files', 'README.md', '--snippet', 'README.md:2-3', '--tool', 'claude', '--json'], { json: true }).message;
  const roomFile = path.join(process.env.MYFRIENDS_HOME, 'rooms', a.room, 'messages.jsonl');
  const lines = fs.readFileSync(roomFile, 'utf8').trim().split('\n');
  assert.ok(lines.every((l) => Buffer.byteLength(l) < 4096), 'todas as linhas < 4 KB');
  assert.ok(fs.existsSync(path.join(process.env.MYFRIENDS_HOME, 'rooms', a.room, 'blobs', `${bm.id}.json`)), 'blob gravado');
  const got = mf(['read', '--tool', 'codex', '--json'], { json: true }).messages.find((m) => m.id === bm.id);
  assert.strictEqual(got.text, big, 'conteúdo completo volta do blob');
  assert.deepStrictEqual(got.snippets[0], { path: 'README.md', lines: '2-3', text: 'linha 2\nlinha 3' });
  assert.ok(/segredos/.test(mf(['share', '--summary', 'x', '--snippet', '.env', '--tool', 'claude', '--json'], { json: true, allowError: true }).error), 'recusa .env');
  assert.ok(/segredos/.test(mf(['send', 'x', '--files', 'config/.env', '--tool', 'claude', '--json'], { json: true, allowError: true }).error));
  fs.writeFileSync(path.join(tmp, 'fora.txt'), 'fora');
  assert.ok(/fora do projeto/.test(mf(['share', '--summary', 'x', '--snippet', '../fora.txt', '--tool', 'claude', '--json'], { json: true, allowError: true }).error), 'trecho fora do projeto recusado');
  const sm = mf(['send', 'minha chave é ' + 'sk-ant-' + 'api03-abcdefghijklmnopqrstuvwxyz e ' + 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123', '--tool', 'claude', '--json'], { json: true }).message;
  assert.ok(!fs.readFileSync(roomFile, 'utf8').includes('sk-ant-api03'), 'segredo não é gravado');
  assert.strictEqual(sm.redacted, 2);
  console.log('✓ mensagens grandes em blob, trechos de arquivo, segredos recusados/removidos');

  // ---------- permissões ----------
  if (process.platform !== 'win32') {
    const mode = (p) => fs.statSync(p).mode & 0o777;
    assert.strictEqual(mode(process.env.MYFRIENDS_HOME), 0o700);
    assert.strictEqual(mode(path.join(process.env.MYFRIENDS_HOME, 'sessions')), 0o700);
    assert.strictEqual(mode(path.join(process.env.MYFRIENDS_HOME, 'rooms', a.room)), 0o700);
    assert.strictEqual(mode(roomFile), 0o600);
    assert.strictEqual(mode(path.join(process.env.MYFRIENDS_HOME, 'sessions', `${a.id}.json`)), 0o600);
    assert.strictEqual(mode(path.join(process.env.MYFRIENDS_HOME, 'rooms', a.room, 'blobs', `${bm.id}.json`)), 0o600);
    for (const f of fs.readdirSync(path.join(process.env.MYFRIENDS_HOME, 'state'))) assert.strictEqual(mode(path.join(process.env.MYFRIENDS_HOME, 'state', f)), 0o600);
    console.log('✓ permissões 700/600');
  }

  // ---------- sala nomeada ----------
  mf(['join', '--room', 'Revisão Geral', '--tool', 'codex', '--session', b.id]);
  assert.strictEqual(hub.getSession(b.id).room, 'revisao-geral');
  mf(['send', 'na sala nomeada', '--tool', 'codex']);
  assert.strictEqual(hub.messages('revisao-geral').length, 1);
  // mensagem direta para quem está em outra sala: erro, nada gravado
  const cross = mf(['send', 'handoff perdido', '--type', 'handoff', '--to', b.id, '--tool', 'claude', '--json'], { json: true, allowError: true });
  assert.ok(/revisao-geral/.test(cross.error) && !hub.messages(a.room, { limit: 0 }).some((m) => m.text === 'handoff perdido'), 'send --to para outra sala falha');
  mf(['room', a.room, '--tool', 'codex']);
  assert.strictEqual(hub.getSession(b.id).room, a.room);
  console.log('✓ salas nomeadas');

  // ---------- servidor: rotas, SSE, skill padrão, instalação ----------
  const { startServer } = require('../src/server');
  const { server, url } = await startServer({ root: ws, port: 0 });
  const api = async (p, opts = {}) => {
    const rr = await fetch(url + p, { method: opts.method || 'GET', headers: { 'content-type': 'application/json', 'x-lastgravity': '1' }, body: opts.body && JSON.stringify(opts.body) });
    const j = await rr.json(); if (!rr.ok) throw Object.assign(new Error(j.error), { status: rr.status }); return j;
  };
  const lgSkill = path.join(process.env.LASTGRAVITY_HOME, 'skills', 'myfriends');
  assert.ok(fs.existsSync(path.join(lgSkill, 'SKILL.md')), 'skill instalada por padrão no LastGravity');
  const lgMd = fs.readFileSync(path.join(lgSkill, 'SKILL.md'), 'utf8');
  assert.ok(lgMd.includes(path.join(lgSkill, 'scripts', 'myfriends.js').replace(/\\/g, '/')) && lgMd.includes('--tool lastgravity') && !lgMd.includes('{{MYFRIENDS_CLI}}') && !lgMd.includes('{{TOOL}}'), 'caminho da CLI e ferramenta preenchidos');
  assert.ok(fs.existsSync(path.join(lgSkill, 'scripts', 'hub.js')));
  const skillsList = await api('/api/skills');
  assert.ok(skillsList.skills.some((s) => s.name === 'myfriends'));

  let st = await api('/api/friends');
  assert.ok(st.available);
  assert.strictEqual(st.room, a.room);
  assert.ok(st.sessions.some((s) => s.id === a.id) && st.sessions.some((s) => s.id === st.me.id && s.kind === 'human'));
  assert.ok(st.messages.length >= 3 && st.board.tasks.length >= 1);
  let rr = await fetch(url + '/api/friends/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) });
  assert.strictEqual(rr.status, 403, 'POST sem cabeçalho bloqueado');
  await assert.rejects(api('/api/friends/send', { method: 'POST', body: { text: '' } }), (e) => e.status === 400);
  await assert.rejects(api('/api/friends/send', { method: 'POST', body: { text: 'x', to: 'ninguem-com-esse-nome' } }), (e) => e.status === 400);
  await assert.rejects(api('/api/friends/send', { method: 'POST', body: { text: 'x', to: b.id, room: 'sala-vazia' } }), (e) => e.status === 400 && /est[aá] na sala/.test(e.message), 'rota recusa --to para outra sala');

  // SSE "friends" quando chega mensagem nova de outro processo
  const ctrl = new AbortController();
  const sse = await fetch(url + '/api/events', { signal: ctrl.signal });
  const reader = sse.body.getReader();
  let sseText = '';
  const gotEvent = (async () => { const dec = new TextDecoder(); for (;;) { const { value, done } = await reader.read(); if (done) return false; sseText += dec.decode(value); if (sseText.includes('event: friends')) return true; } })();
  await sleep(300);
  mf(['send', 'olá LastGravity', '--tool', 'claude']);
  assert.ok(await Promise.race([gotEvent, sleep(6000).then(() => false)]), 'evento SSE friends');
  ctrl.abort();
  await api('/api/friends/send', { method: 'POST', body: { text: 'oi, aqui é o usuário pelo painel', to: 'codex', type: 'task' } });
  const fromUser = mf(['read', '--tool', 'codex', '--json'], { json: true }).messages.find((m) => m.text === 'oi, aqui é o usuário pelo painel');
  assert.ok(fromUser && fromUser.type === 'task' && /Você \(LastGravity\)/.test(fromUser.fromName));
  console.log('✓ rotas /api/friends e /api/friends/send, CSRF, evento SSE friends, skill padrão no LastGravity');

  // instalação nas IDEs com HOME falso
  fs.mkdirSync(path.join(fakeHome, '.claude'));
  fs.mkdirSync(path.join(fakeHome, '.codex'));
  let tg = await api('/api/friends/targets');
  const byId = Object.fromEntries(tg.targets.map((t) => [t.id, t]));
  assert.ok(byId.lastgravity.installed && byId.lastgravity.builtin);
  assert.ok(byId.claude.detected && !byId.claude.installed);
  assert.ok(byId.codex.detected && !byId.codex.installed);
  assert.ok(!byId.antigravity.detected, 'Antigravity não existe no HOME falso');
  assert.strictEqual(byId.claude.dir, path.join(fakeHome, '.claude', 'skills', 'myfriends'));
  assert.strictEqual(byId.codex.dir, path.join(fakeHome, '.agents', 'skills', 'myfriends'));
  assert.strictEqual(byId.antigravity.dir, path.join(fakeHome, '.gemini', 'config', 'skills', 'myfriends'));
  const dry = await api('/api/friends/install', { method: 'POST', body: { targets: ['claude', 'codex', 'antigravity'] } });
  assert.ok(dry.dryRun && dry.plan.length === 2, 'só onde a IDE existe');
  assert.ok(dry.plan[0].files.some((f) => f.path.endsWith('SKILL.md')));
  assert.ok(!fs.existsSync(byId.claude.dir), 'sem confirmação nada é gravado');
  await assert.rejects(api('/api/friends/install', { method: 'POST', body: { targets: ['antigravity'], confirm: true } }), (e) => e.status === 400);
  await assert.rejects(api('/api/friends/install', { method: 'POST', body: { targets: ['../../etc'], confirm: true } }), (e) => e.status === 400);
  const inst = await api('/api/friends/install', { method: 'POST', body: { targets: ['claude', 'codex'], confirm: true } });
  assert.deepStrictEqual(inst.installed.map((x) => x.id), ['claude', 'codex']);
  const ccMd = fs.readFileSync(path.join(byId.claude.dir, 'SKILL.md'), 'utf8');
  assert.ok(ccMd.startsWith('---\nname: myfriends\ndescription: '), 'frontmatter no início');
  assert.ok(ccMd.includes(path.join(byId.claude.dir, 'scripts', 'myfriends.js').replace(/\\/g, '/')) && ccMd.includes('--tool claude'));
  assert.ok(fs.readFileSync(path.join(byId.codex.dir, 'SKILL.md'), 'utf8').includes('--tool codex'));
  assert.ok(!fs.readdirSync(path.join(fakeHome, '.claude', 'skills')).some((n) => n !== 'myfriends'), 'sem pastas temporárias ao lado');
  tg = await api('/api/friends/targets');
  assert.ok(tg.targets.find((t) => t.id === 'claude').upToDate);
  // a cópia instalada funciona sozinha (CLI dentro da pasta da skill)
  const out = spawnSync(process.execPath, [path.join(byId.claude.dir, 'scripts', 'myfriends.js'), 'who', '--tool', 'claude'], { cwd: ws, env, encoding: 'utf8' });
  assert.ok(out.stdout.includes(a.id), out.stderr);
  // reinstalar a partir de uma cópia instalada usa o modelo original
  const I2 = require(path.join(byId.claude.dir, 'scripts', 'install.js'));
  const rendered = I2.render(path.join(tmp, 'x', 'myfriends'), 'antigravity', byId.claude.dir).find((f) => f.rel === 'SKILL.md').data.toString();
  assert.ok(rendered.includes('--tool antigravity') && !rendered.includes('--tool claude'));
  console.log('✓ /api/friends/targets e /api/friends/install (HOME falso, confirmação, só IDEs encontradas)');

  // install.sh (macOS/Linux)
  if (process.platform !== 'win32') {
    fs.mkdirSync(path.join(fakeHome, '.gemini', 'antigravity'), { recursive: true });
    const sh = spawnSync('sh', [path.join(__dirname, '..', 'skills', 'myfriends', 'install.sh'), '--yes', '--only', 'antigravity'], { env, encoding: 'utf8' });
    assert.strictEqual(sh.status, 0, sh.stderr + sh.stdout);
    assert.ok(fs.existsSync(path.join(fakeHome, '.gemini', 'config', 'skills', 'myfriends', 'SKILL.md')), sh.stdout);
    const shDry = spawnSync('sh', [path.join(__dirname, '..', 'skills', 'myfriends', 'install.sh')], { env, encoding: 'utf8', input: 'n\n' });
    assert.ok(shDry.stdout.includes('Nada foi alterado'));
    console.log('✓ install.sh no HOME falso');
  }

  // ---------- agente mock do LastGravity com friends_send / friends_read ----------
  const waitFor = async (id, pred, label) => { for (let i = 0; i < 150; i++) { const x = await api(`/api/agents/${id}`); if (pred(x)) return x; await sleep(100); } const x = await api(`/api/agents/${id}`); throw new Error('timeout: ' + label + ' ' + x.status + ' ' + JSON.stringify(x.timeline.slice(-3))); };
  mf(['read', '--tool', 'codex']); // zera o cursor do Codex
  const ag = await api('/api/agents', { method: 'POST', body: { prompt: 'friends: olá amigos, alguém pode revisar o README?', providerId: 'mock', approval: 'ask-commands' } });
  const fin = await waitFor(ag.id, (x) => x.status === 'done' || x.status === 'error', 'agente friends');
  assert.strictEqual(fin.status, 'done', JSON.stringify(fin.timeline.filter((t) => t.kind === 'error')));
  const sendItem = fin.timeline.find((t) => t.kind === 'tool' && t.name === 'friends_send');
  assert.ok(sendItem && sendItem.state === 'done', 'friends_send (chat) não pede aprovação');
  const readItem = fin.timeline.find((t) => t.kind === 'tool' && t.name === 'friends_read');
  assert.ok(readItem && /olá LastGravity|Nenhuma/.test(readItem.output), readItem?.output);
  assert.ok(/olá LastGravity/.test(readItem.output), 'o agente lê as mensagens que chegaram antes dele (sala do projeto)');
  const fromAgent = mf(['read', '--tool', 'codex', '--json'], { json: true }).messages.find((m) => m.text.startsWith('olá amigos'));
  assert.ok(fromAgent && fromAgent.fromName.startsWith('LastGravity · '), 'o agente aparece como sessão "LastGravity · <título>"');
  st = await api('/api/friends');
  assert.ok(st.agents[ag.id] && st.sessions.some((s) => s.id === st.agents[ag.id]));
  // task pede aprovação fora do modo autônomo
  const ag2 = await api('/api/agents', { method: 'POST', body: { prompt: 'friends-task: rode os testes de integração', providerId: 'mock', approval: 'ask-commands' } });
  const w2 = await waitFor(ag2.id, (x) => x.status === 'awaiting_approval', 'aprovação da task');
  const call = w2.timeline.find((t) => t.state === 'awaiting_approval');
  assert.strictEqual(call.name, 'friends_send');
  assert.strictEqual(call.args.type, 'task');
  await api(`/api/agents/${ag2.id}/approve`, { method: 'POST', body: { callId: call.callId, approved: false } });
  await waitFor(ag2.id, (x) => x.status === 'done', 'fim após rejeição');
  assert.ok(!mf(['tasks', '--tool', 'codex']).stdout.includes('rode os testes de integração'), 'task rejeitada não foi enviada');
  // removendo o agente, a sessão dele sai do hub
  const sid = st.agents[ag.id];
  await api(`/api/agents/${ag.id}`, { method: 'DELETE' });
  assert.ok(!hub.getSession(sid));
  console.log('✓ agente mock: friends_send/friends_read, sessão "LastGravity · …", task pede aprovação');

  // ---------- lastgravity friends (CLI do LastGravity) ----------
  const bin = path.join(__dirname, '..', 'bin', 'lastgravity.js');
  let lg = spawnSync(process.execPath, [bin, 'friends', 'who'], { cwd: ws, env, encoding: 'utf8' });
  assert.strictEqual(lg.status, 0, lg.stderr);
  assert.ok(lg.stdout.includes(a.id) && lg.stdout.includes('Claude Code · meu-projeto'), lg.stdout);
  lg = spawnSync(process.execPath, [bin, 'friends', 'send', 'oi do terminal do LastGravity'], { cwd: ws, env, encoding: 'utf8' });
  assert.strictEqual(lg.status, 0, lg.stderr);
  assert.ok(mf(['read', '--tool', 'claude', '--json'], { json: true }).messages.some((m) => m.text === 'oi do terminal do LastGravity' && m.tool === 'lastgravity'));
  lg = spawnSync(process.execPath, [bin, 'friends', 'install'], { cwd: ws, env, encoding: 'utf8' });
  assert.ok(lg.stdout.includes('Nada foi alterado') && lg.stdout.includes('Claude Code'), lg.stdout);
  lg = spawnSync(process.execPath, [bin, 'help'], { env, encoding: 'utf8' });
  assert.ok(lg.stdout.includes('lastgravity friends'));
  console.log('✓ lastgravity friends who/send/install');

  // ao fechar o servidor, as sessões do LastGravity saem do hub
  const meId = st.me.id;
  await new Promise((res) => server.close(res));
  assert.ok(!hub.getSession(meId), 'sessão do usuário removida ao fechar');
  mf(['leave', '--tool', 'codex']);
  assert.ok(!hub.getSession(b.id));
  assert.ok(!fs.existsSync(path.join(os.userInfo().homedir || '/nonexistent', '.myfriends', 'rooms', a.room)), 'nada no HOME real');

  console.log('\nMyFriends OK.');
  setTimeout(() => process.exit(0), 50);
})().catch((e) => { console.error(e); process.exit(1); });
