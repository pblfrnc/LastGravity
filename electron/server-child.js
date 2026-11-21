// Processo separado que roda o servidor de um projeto. Assim, trabalho pesado (pastas enormes,
// leitura de arquivos, espera de permissão do macOS) nunca congela a interface do app.
const fs = require('fs');
const { startServer } = require('../src/server');
const config = require('../src/config');

const root = process.argv[2];
const send = (msg) => { try { process.parentPort.postMessage(msg); } catch {} };

(async () => {
  let st;
  try { st = await fs.promises.stat(root); } catch (e) { throw new Error(e.code === 'EPERM' || e.code === 'EACCES' ? 'O macOS não liberou o acesso a esta pasta. Libere em Ajustes do Sistema → Privacidade e Segurança → Arquivos e Pastas (ou Acesso Total ao Disco) para o LastGravity.' : 'Pasta não encontrada.'); }
  if (!st.isDirectory()) throw new Error('Não é uma pasta.');
  // "Novo projeto": a pasta foi criada/escolhida pelo próprio usuário, então já nasce confiável.
  if (process.argv.includes('--trust')) {
    const cfg = config.load();
    const real = fs.realpathSync.native(root);
    if (!(cfg.trustedFolders || []).includes(real)) { cfg.trustedFolders = [...(cfg.trustedFolders || []), real]; config.save(cfg); }
  }
  return startServer({ root, port: 0 });
})()
  .then(({ url }) => send({ type: 'ready', url }))
  .catch((e) => { send({ type: 'error', message: e.message }); setTimeout(() => process.exit(1), 100); });

process.parentPort?.on('message', (e) => { if (e.data?.type === 'stop') process.exit(0); });
