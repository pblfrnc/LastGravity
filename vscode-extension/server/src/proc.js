// Execução de comandos que mata a árvore inteira de processos (timeout e Parar funcionam
// mesmo com `npm run dev`), env sem chaves de API, e processos em segundo plano com log.
const { spawn, execFile } = require('child_process');
const net = require('net');

const MAX_OUT = 20000;
const clip = (s) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + `\n…[cortado, ${s.length - MAX_OUT} caracteres omitidos]` : s);
const SECRET_ENV = /(_API_KEY|_TOKEN|_SECRET|_PASSWORD)$|^AWS_BEARER_TOKEN_BEDROCK$/i;
const KEEP_ENV = new Set(['GITHUB_TOKEN']); // necessário para git/gh, mas apenas se o usuário optar (ver childEnv)

function childEnv(extra = {}, { keepSecrets = false } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!keepSecrets && SECRET_ENV.test(k) && !KEEP_ENV.has(k)) continue;
    env[k] = v;
  }
  return { ...env, FORCE_COLOR: '0', ...extra };
}

function killTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.killed && signal === 'SIGTERM') return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    return;
  }
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}
function spawnShell(command, cwd, env) {
  return spawn(command, { cwd, shell: true, env, detached: process.platform !== 'win32', windowsHide: true });
}

function runCommand(root, command, timeoutSec = 120, signal, opts = {}) {
  return new Promise((resolve) => {
    const child = spawnShell(command, root, childEnv({}, opts));
    let out = '', done = false, note = '';
    const onData = (d) => { out += d.toString(); if (out.length > MAX_OUT * 3) out = out.slice(-MAX_OUT * 2); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(grace);
      signal?.removeEventListener('abort', onAbort);
      child.stdout.destroy(); child.stderr.destroy();
      resolve({ code, output: clip(out + note) });
    };
    const stopAll = (why) => {
      note += `\n[${why}]`;
      killTree(child, 'SIGTERM');
      setTimeout(() => killTree(child, 'SIGKILL'), 1500);
      setTimeout(() => finish(null), 2500); // garante retorno mesmo se algum neto segurar os pipes
    };
    const timer = setTimeout(() => stopAll(`tempo esgotado após ${timeoutSec}s — para servidores use start_background`), timeoutSec * 1000);
    const onAbort = () => stopAll('interrompido pelo usuário');
    signal?.addEventListener('abort', onAbort, { once: true });
    let grace;
    // 'exit' chega quando o shell sai; netos podem manter os pipes abertos, então damos um prazo curto.
    child.on('exit', (code) => { grace = setTimeout(() => { killTree(child, 'SIGKILL'); finish(code); }, 1500); });
    child.on('close', (code) => finish(code));
    child.on('error', (err) => { out += String(err); finish(-1); });
  });
}

/* ---------- Processos em segundo plano ---------- */
class ProcessManager {
  constructor({ root, bus }) { this.root = root; this.bus = bus; this.procs = new Map(); this.seq = 0; }

  start(command, { name, port } = {}) {
    const id = `p${++this.seq}`;
    const child = spawnShell(command, this.root, childEnv());
    const p = { id, name: name || command.slice(0, 40), command, pid: child.pid, port: port || null, status: 'running', log: '', startedAt: Date.now(), child };
    const onData = (d) => {
      const s = d.toString();
      p.log += s;
      if (p.log.length > 200_000) p.log = p.log.slice(-150_000);
      if (!p.port) { const m = s.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/); if (m) { p.port = Number(m[1]); this.emit(); } }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { p.status = code === 0 || code === null ? 'stopped' : `exited (${code})`; p.exitCode = code; this.emit(); });
    child.on('error', (e) => { p.log += String(e); p.status = 'error'; this.emit(); });
    this.procs.set(id, p);
    this.emit();
    return p;
  }

  async waitReady(id, timeoutMs = 20000) {
    const p = this.get(id);
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs && p.status === 'running') {
      if (p.port && await portOpen(p.port)) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return p.status === 'running' && !!p.port && portOpen(p.port);
  }

  stop(id) {
    const p = this.get(id);
    killTree(p.child, 'SIGTERM');
    setTimeout(() => killTree(p.child, 'SIGKILL'), 2000);
    p.status = 'stopping';
    this.emit();
    return p;
  }
  get(id) { const p = this.procs.get(id); if (!p) throw Object.assign(new Error(`Processo ${id} não encontrado.`), { status: 404 }); return p; }
  list() { return [...this.procs.values()].map(({ child, log, ...rest }) => ({ ...rest, logTail: log.slice(-2000) })); }
  read(id, lines = 80) { return this.get(id).log.split('\n').slice(-lines).join('\n'); }
  stopAll() { for (const p of this.procs.values()) if (p.status === 'running') killTree(p.child, 'SIGKILL'); }
  emit() { this.bus?.emit('procs', this.list()); }
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.setTimeout(800);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}

module.exports = { runCommand, ProcessManager, childEnv, killTree, clip, MAX_OUT };
