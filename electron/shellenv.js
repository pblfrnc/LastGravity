// Apps abertos pelo Dock no macOS não herdam o ambiente do terminal (PATH, JAVA_HOME, ANDROID_HOME,
// FLUTTER_ROOT, NVM_DIR, LANG…). Importamos o ambiente completo do shell de login, para que o
// terminal e os agentes encontrem node, flutter, java, brew etc.
const { execFileSync } = require('child_process');

const SKIP = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'ELECTRON_RUN_AS_NODE', 'TERM_SESSION_ID', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION']);

function fixPath() {
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const script = `ELECTRON_RUN_AS_NODE=1 "${process.execPath}" -e 'process.stdout.write("__LG__"+JSON.stringify(process.env)+"__LG__")'`;
    const out = execFileSync(shell, ['-ilc', script], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/__LG__([\s\S]*)__LG__/);
    if (m) {
      const env = JSON.parse(m[1]);
      for (const [k, v] of Object.entries(env)) if (!SKIP.has(k) && typeof v === 'string') process.env[k] = v;
    }
  } catch {
    // Plano B: só o PATH
    try {
      const out = execFileSync(shell, ['-ilc', 'echo "__LG__${PATH}__LG__"'], { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/__LG__(.*)__LG__/);
      if (m && m[1]) process.env.PATH = m[1];
    } catch {}
  }
  const parts = new Set((process.env.PATH || '').split(':').filter(Boolean));
  for (const e of ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']) parts.add(e);
  process.env.PATH = [...parts].join(':');
  if (!process.env.LANG) process.env.LANG = 'pt_BR.UTF-8';
}

module.exports = { fixPath };
