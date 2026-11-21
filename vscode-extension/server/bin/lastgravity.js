#!/usr/bin/env node
// LastGravity — ponto de entrada.
//   lastgravity [pasta] [--port 4747]          abre a IDE no navegador
//   lastgravity run "tarefa" [opções]           roda um agente pelo terminal (--bg para segundo plano)
//   lastgravity ps | logs <id> [-f] | kill <id> | agents | trust [pasta] | help
const path = require('path');
const fs = require('fs');

const HELP = `LastGravity — IDE com agentes de IA

Interface:
  lastgravity [pasta] [--port 4747]

Terminal:
  lastgravity run "tarefa" [--dir pasta] [--provider id] [--model nome] [--approval auto|ask-commands|ask-all] [--bg]
  lastgravity run --continue "mais instruções"     continua o último agente da pasta
  lastgravity run --resume <agt_id> "mensagem"     continua um agente específico
  lastgravity agents [--dir pasta]                  lista os agentes da pasta
  lastgravity ps                                    execuções em segundo plano
  lastgravity logs <id> [-f]                        log de uma execução (-f acompanha)
  lastgravity kill <id>                             para uma execução
  lastgravity trust [pasta]                         marca a pasta como confiável

MyFriends (conversa com sessões do Claude Code, Codex, Antigravity…):
  lastgravity friends who                           quem está online
  lastgravity friends read [--wait 30]              mensagens novas da sala do projeto
  lastgravity friends send "texto" [--to quem] [--type chat|context|task|handoff]
  lastgravity friends tasks | claim <id> | done <id> "resultado"
  lastgravity friends install [--yes] [--only claude,codex,antigravity]   instala a skill nas outras IDEs

Provedores: anthropic, gemini, openai, openrouter, ollama, mock (e os que você adicionar).`;

(async () => {
  const args = process.argv.slice(2);
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') { console.log(HELP); return; }
  if (['run', 'ps', 'logs', 'kill', 'agents', 'trust', 'friends'].includes(args[0])) {
    try { process.exitCode = await require('../src/cli').main(args); }
    catch (e) { console.error(`Erro: ${e.message}`); process.exitCode = 1; }
    if (args[0] !== 'logs') setTimeout(() => process.exit(process.exitCode), 50).unref();
    return;
  }
  const { startServer } = require('../src/server');
  let port = Number(process.env.LASTGRAVITY_PORT || 4747);
  let folder = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = Number(args[++i]);
    else if (!args[i].startsWith('--')) folder = args[i];
  }
  const root = path.resolve(folder);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`Pasta não encontrada: ${root}`);
    process.exit(1);
  }
  const { url } = await startServer({ root, port });
  console.log(`\n  🚀 LastGravity rodando em ${url}`);
  console.log(`  📁 Projeto: ${root}\n`);
})();
