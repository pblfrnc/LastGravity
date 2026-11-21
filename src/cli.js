// CLI do LastGravity: rodar tarefas pelo terminal, em primeiro ou segundo plano.
//   lastgravity run "tarefa" [--dir pasta] [--provider id] [--model nome] [--approval auto|ask-commands|ask-all] [--bg]
//   lastgravity run --continue "mais instruções"      (continua o último agente da pasta)
//   lastgravity run --resume <agt_id> "mensagem"
//   lastgravity ps | logs <id> [-f] | kill <id> | agents [--dir pasta] | trust [pasta]
//   lastgravity friends <who|read|send|tasks|claim|done|install> …   (MyFriends: sessões de outras IDEs)
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const config = require('./config');

const RUNS = path.join(config.DIR, 'runs');
const C = process.stdout.isTTY ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, ok: (s) => `\x1b[32m${s}\x1b[0m`, err: (s) => `\x1b[31m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, acc: (s) => `\x1b[38;5;209m${s}\x1b[0m` } : new Proxy({}, { get: () => (s) => s });

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bg' || a === '--continue' || a === '-f' || a === '--follow' || a === '--json') o[a.replace(/^-+/, '')] = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

const summarize = (t) => {
  const a = t.args || {};
  return a.command || a.path || a.pattern || a.url || a.query || a.question || a.prompt?.slice(0, 60) || '';
};

async function run(o) {
  const root = path.resolve(o.dir || process.cwd());
  if (!fs.existsSync(root)) throw new Error(`Pasta não encontrada: ${root}`);
  const task = o._.join(' ').trim();

  if (o.bg) {
    fs.mkdirSync(RUNS, { recursive: true });
    const id = `r${Date.now().toString(36)}`;
    const log = path.join(RUNS, `${id}.log`);
    const args = process.argv.slice(2).filter((a) => a !== '--bg');
    const out = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'lastgravity.js'), ...args, '--run-id', id], { cwd: root, detached: true, stdio: ['ignore', out, out], env: { ...process.env, LASTGRAVITY_HEADLESS: '1' } });
    child.unref();
    fs.writeFileSync(path.join(RUNS, `${id}.json`), JSON.stringify({ id, pid: child.pid, dir: root, task, startedAt: Date.now(), status: 'running', log }));
    console.log(`${C.ok('▶')} Rodando em segundo plano: ${C.b(id)} (pid ${child.pid})`);
    console.log(C.dim(`   lastgravity logs ${id} -f   ·   lastgravity kill ${id}   ·   lastgravity ps`));
    return 0;
  }

  const cfg = config.load();
  const { AgentManager } = require('./agent');
  const { McpManager } = require('./mcp');
  const { ProcessManager } = require('./proc');
  const { realRoot } = require('./fsafe');
  const bus = new EventEmitter();
  const mcp = new McpManager({ root, getConfig: () => cfg });
  const procs = new ProcessManager({ root, bus });
  const trusted = () => (cfg.trustedFolders || []).includes(realRoot(root));
  const manager = new AgentManager({ root, getConfig: () => cfg, bus, mcp, procs, trusted });
  await mcp.sync().catch(() => {});

  const interactive = process.stdin.isTTY && !process.env.LASTGRAVITY_HEADLESS;
  let agent;
  if (o.continue || o.resume) {
    agent = o.resume ? manager.get(o.resume) : manager.last();
    if (!agent) throw new Error('Nenhum agente anterior nesta pasta.');
    if (o.provider || o.model) agent.update({ providerId: o.provider, model: o.model });
    if (o.approval) agent.update({ approval: o.approval });
  } else {
    if (!task) throw new Error('Descreva a tarefa: lastgravity run "crie testes para utils.js"');
    agent = null;
  }

  const printed = new Map();
  let rl = null;
  bus.on('timeline', ({ agentId, item }) => {
    if (agent && agentId !== agent.id) return;
    if (item.kind === 'assistant') {
      const prev = printed.get(item.id) || 0;
      if (item.text.length > prev) { process.stdout.write(item.text.slice(prev)); printed.set(item.id, item.text.length); }
      if (!item.streaming && !printed.get(`${item.id}:nl`)) { process.stdout.write('\n'); printed.set(`${item.id}:nl`, 1); }
    } else if (item.kind === 'tool') {
      const key = `${item.id}:${item.state}`;
      if (printed.has(key)) return;
      printed.set(key, 1);
      if (item.state === 'running' && !printed.has(`${item.id}:start`)) { printed.set(`${item.id}:start`, 1); console.log(C.acc(`▸ ${item.name}`), C.dim(summarize(item))); }
      else if (item.state === 'done') console.log(C.ok('  ✓'), C.dim(String(item.output || '').split('\n')[0].slice(0, 120)));
      else if (item.state === 'error') console.log(C.err('  ✗'), String(item.output || '').split('\n')[0].slice(0, 200));
      else if (item.state === 'rejected') console.log(C.warn('  ⊘ rejeitado'));
      else if (item.state === 'awaiting_approval') {
        if (!interactive) { console.log(C.warn(`  ⚠ ${item.name} precisa de aprovação; rejeitado automaticamente (sem terminal). Use --approval auto se quiser.`)); setImmediate(() => { try { agent.approve(item.callId, false); } catch {} }); return; }
        rl = rl || readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(C.warn(`  ? Permitir ${item.name}: ${summarize(item)}  [s]im / [n]ão / [a]provar sempre: `), (ans) => {
          const a = String(ans).trim().toLowerCase();
          try {
            if (a === 'a') agent.update({ approval: 'auto' });
            else agent.approve(item.callId, a === 's' || a === 'y' || a === 'sim');
          } catch {}
        });
      }
    } else if (item.kind === 'error') console.log(C.err(`✗ ${item.text}`));
    else if (item.kind === 'info') console.log(C.dim(`· ${item.text}`));
  });

  const finished = new Promise((resolve) => bus.on('agent', (s) => { if (agent && s.id === agent.id && (s.status === 'done' || s.status === 'error' || (s.status === 'idle' && agent.stopRequested))) resolve(s.status); }));
  process.on('SIGINT', () => { console.log(C.warn('\nParando…')); agent?.stop(); setTimeout(() => process.exit(130), 3000); });
  process.on('SIGTERM', () => { agent?.stop(); procs.stopAll(); setTimeout(() => process.exit(143), 1500); });

  if (agent) {
    console.log(C.dim(`Continuando ${agent.id} · ${agent.title}`));
    await agent.send(task || 'continue');
  } else {
    const pid = o.provider || cfg.defaultProvider;
    agent = manager.create({ prompt: task, providerId: pid, model: o.model, approval: o.approval || cfg.approval });
    const p = cfg.providers[pid];
    console.log(C.dim(`Agente ${agent.id} · ${p?.label} · ${o.model || p?.model} · aprovação ${agent.policy()}${trusted() ? '' : ' (pasta não confiável: rode "lastgravity trust" para liberar o modo autônomo)'}`));
  }
  const status = await finished;
  rl?.close();
  const u = agent.usage;
  console.log(C.dim(`\n${status === 'done' ? '✔ concluído' : status} · ${u.input.toLocaleString('pt-BR')} tok entrada · ${u.output.toLocaleString('pt-BR')} saída${u.cost ? ` · US$ ${u.cost.toFixed(4)}` : ''} · ${Object.keys(agent.changes).length} arquivo(s) alterado(s)`));
  agent.persist(true);
  procs.stopAll();
  await mcp.closeAll().catch(() => {});
  if (o['run-id']) {
    const f = path.join(RUNS, `${o['run-id']}.json`);
    try { const r = JSON.parse(fs.readFileSync(f, 'utf8')); fs.writeFileSync(f, JSON.stringify({ ...r, status, agentId: agent.id, endedAt: Date.now() })); } catch {}
  }
  return status === 'done' ? 0 : 1;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function runs() {
  let files = [];
  try { files = fs.readdirSync(RUNS).filter((f) => f.endsWith('.json')); } catch {}
  return files.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt);
}
function findRun(id) {
  const r = runs().find((x) => x.id === id || x.id.startsWith(id || ''));
  if (!r) throw new Error(`Execução não encontrada: ${id}. Veja "lastgravity ps".`);
  return r;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const o = parse(rest);
  switch (cmd) {
    case 'run': return run(o);
    case 'friends': return require('./friends').cliMain(rest);
    case 'ps': {
      const list = runs();
      if (!list.length) { console.log('Nenhuma execução em segundo plano.'); return 0; }
      for (const r of list.slice(0, 30)) {
        const st = r.status === 'running' ? (alive(r.pid) ? C.ok('rodando') : C.err('interrompido')) : r.status === 'done' ? C.ok('concluído') : C.warn(r.status);
        console.log(`${C.b(r.id)}  ${st}  ${new Date(r.startedAt).toLocaleString('pt-BR')}  ${C.dim(r.dir)}\n   ${String(r.task).slice(0, 100)}`);
      }
      return 0;
    }
    case 'logs': {
      const r = findRun(o._[0]);
      let pos = 0;
      const dump = () => { try { const b = fs.readFileSync(r.log); if (b.length > pos) { process.stdout.write(b.subarray(pos)); pos = b.length; } } catch {} };
      dump();
      if (!(o.f || o.follow)) return 0;
      return new Promise((resolve) => {
        const t = setInterval(() => { dump(); if (!alive(r.pid)) { clearInterval(t); dump(); resolve(0); } }, 500);
        process.on('SIGINT', () => { clearInterval(t); resolve(0); });
      });
    }
    case 'kill': {
      const r = findRun(o._[0]);
      if (!alive(r.pid)) { console.log('Já terminou.'); return 0; }
      try { process.kill(-r.pid, 'SIGTERM'); } catch { try { process.kill(r.pid, 'SIGTERM'); } catch {} }
      console.log(`Parando ${r.id}…`);
      return 0;
    }
    case 'agents': {
      const root = path.resolve(o.dir || process.cwd());
      const dir = path.join(root, '.lastgravity', 'agents');
      let list = [];
      try { list = fs.readdirSync(dir).filter((f) => /^agt_\w+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch {}
      if (!list.length) { console.log('Nenhum agente nesta pasta.'); return 0; }
      for (const a of list.sort((x, y) => y.createdAt - x.createdAt)) console.log(`${C.b(a.id)}  ${a.status}  ${new Date(a.updatedAt || a.createdAt).toLocaleString('pt-BR')}  ${a.title}`);
      console.log(C.dim('\nContinue com: lastgravity run --resume <id> "mensagem"'));
      return 0;
    }
    case 'trust': {
      const root = path.resolve(o._[0] || process.cwd());
      const real = fs.realpathSync.native(root);
      const cfg = config.load();
      if (!(cfg.trustedFolders || []).includes(real)) cfg.trustedFolders = [...(cfg.trustedFolders || []), real];
      config.save(cfg);
      console.log(`${C.ok('✔')} Pasta confiável: ${real}`);
      return 0;
    }
    default:
      return null; // não é subcomando: abre a interface
  }
}

module.exports = { main, parse };
