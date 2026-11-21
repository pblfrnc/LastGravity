// Ferramentas que os agentes podem usar. Todas confinadas à pasta do projeto (inclusive contra symlinks).
const fs = require('fs');
const path = require('path');
const { safePath } = require('./fsafe');
const { runCommand, clip } = require('./proc');
const web = require('./webtools');
const { isLocalUrl } = require('./providers/util');

const IGNORE = new Set(['.git', 'node_modules', 'vendor', 'coverage', 'Pods', '.gradle', '.lastgravity', '.dart_tool', 'build', 'dist', '.next', '__pycache__', '.venv', 'venv']);
const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/') || '.';
const MAX_READ = 2_000_000;

const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const S = (description) => ({ type: 'string', ...(description ? { description } : {}) });
const I = (description) => ({ type: 'integer', ...(description ? { description } : {}) });

const DEFS = [
  { name: 'list_dir', description: 'Lista arquivos e pastas de um diretório do projeto.', parameters: obj({ path: S('Caminho relativo (padrão ".")') }) },
  { name: 'read_file', description: 'Lê um arquivo de texto. Pode limitar por linhas (1-indexado). Use start_line/end_line em arquivos grandes.', parameters: obj({ path: S(), start_line: I(), end_line: I() }, ['path']) },
  { name: 'write_file', description: 'Cria ou sobrescreve um arquivo inteiro. Para arquivos grandes, escreva em partes (crie e depois use edit_file).', parameters: obj({ path: S(), content: S() }, ['path', 'content']) },
  { name: 'edit_file', description: 'Substitui um trecho exato (old_text, que deve ser único no arquivo) por new_text.', parameters: obj({ path: S(), old_text: S(), new_text: S() }, ['path', 'old_text', 'new_text']) },
  { name: 'glob', description: 'Encontra arquivos por padrão (ex.: "src/**/*.ts", "*.dart", "**/test_*.py"). Mais recentes primeiro.', parameters: obj({ pattern: S() }, ['pattern']) },
  { name: 'search', description: 'Busca uma expressão regular (sem diferenciar maiúsculas) nos arquivos de texto do projeto.', parameters: obj({ pattern: S(), path: S('Subpasta opcional'), glob: S('Filtro opcional de arquivos, ex.: "*.js"') }, ['pattern']) },
  { name: 'run_command', description: 'Executa um comando de terminal na raiz do projeto (testes, build, git, instalar dependências). Para servidores e processos que não terminam, use start_background.', parameters: obj({ command: S(), timeout_sec: I('Padrão 120') }, ['command']) },
  { name: 'start_background', description: 'Inicia um processo que fica rodando (servidor de desenvolvimento, watcher) e devolve o id, a porta detectada e o começo do log.', parameters: obj({ command: S(), name: S('Nome curto'), port: I('Porta esperada, se souber') }, ['command']) },
  { name: 'read_process_log', description: 'Lê as últimas linhas do log de um processo em segundo plano.', parameters: obj({ id: S(), lines: I('Padrão 80') }, ['id']) },
  { name: 'stop_background', description: 'Encerra um processo em segundo plano (e todos os filhos dele).', parameters: obj({ id: S() }, ['id']) },
  { name: 'list_processes', description: 'Lista os processos em segundo plano deste projeto.', parameters: obj({}) },
  { name: 'fetch_url', description: 'Abre uma URL (ex.: http://localhost:3000 do seu servidor, ou uma página de documentação) e devolve status e conteúdo em texto legível.', parameters: obj({ url: S() }, ['url']) },
  { name: 'web_search', description: 'Pesquisa na web e devolve títulos, links e trechos. Use fetch_url para ler um resultado.', parameters: obj({ query: S() }, ['query']) },
  { name: 'repo_map', description: 'Mostra o mapa do repositório: arquivos de código mais centrais (ordenados por imports) e seus principais símbolos. Use para se orientar em projetos grandes.', parameters: obj({}) },
  { name: 'explore', description: 'Delega uma pergunta de leitura a um sub-agente explorador (somente leitura, pode usar um modelo mais barato). Ideal para "onde fica X?", "como funciona Y?".', parameters: obj({ question: S() }, ['question']) },
  { name: 'task', description: 'Delega uma tarefa a um sub-agente especializado. Tipos: "explore" (só leitura, responde perguntas sobre o código), "plan" (só leitura, devolve um plano detalhado), "general" (faz alterações e roda comandos), "frontend" (interfaces web/mobile, foco em UI). Cada tipo pode usar outro modelo (Configurações → Modelos).', parameters: obj({ type: { type: 'string', enum: ['explore', 'plan', 'general', 'frontend'] }, prompt: S('Instruções completas e autocontidas para o sub-agente') }, ['type', 'prompt']) },
  { name: 'update_plan', description: 'Publica/atualiza o plano de tarefas visível ao usuário. Use no início e sempre que concluir uma etapa.', parameters: obj({ steps: { type: 'array', items: obj({ title: S(), status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, ['title', 'status']) } }, ['steps']) },
];

const READ_ONLY = ['list_dir', 'read_file', 'glob', 'search', 'repo_map', 'list_processes', 'read_process_log'];

// Quais ferramentas pedem aprovação em cada política.
// Ferramentas MCP (mcp__…) de servidores não confiáveis pedem aprovação fora do modo 'auto'.
function needsApproval(policy, name, { trusted = false, args = {} } = {}) {
  if (policy === 'auto') return false;
  if (typeof name === 'string' && name.startsWith('mcp__')) return !trusted;
  const remoteFetch = name === 'fetch_url' && !isLocalUrl(String(args?.url || ''));
  // MyFriends: pedir trabalho a outra sessão (task) ou passar o trabalho adiante (handoff) sempre pede aprovação.
  if (name === 'friends_send' && ['task', 'handoff'].includes(args?.type)) return true;
  if (policy === 'ask-all') return ['write_file', 'edit_file', 'run_command', 'start_background', 'fetch_url', 'friends_send', 'friends_share', 'friends_claim', 'friends_done'].includes(name);
  // ask-commands (padrão): edições têm desfazer; comandos e envio de dados para fora, não.
  return name === 'run_command' || name === 'start_background' || remoteFetch;
}

function walk(dir, out, limit = 3000) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= limit) return;
    if (IGNORE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, limit);
    else if (e.isFile()) out.push(full);
  }
}

// Regex vinda do modelo: limita tamanho e recusa quantificadores aninhados (risco de travar o app).
function safeRegex(pattern) {
  if (typeof pattern !== 'string' || !pattern) throw new Error('Informe um padrão.');
  if (pattern.length > 300) throw new Error('Padrão longo demais.');
  if (/[+*}?]\)+[+*{]/.test(pattern.replace(/\\./g, ''))) throw new Error('Padrão com quantificadores aninhados (ex.: (a+)+) não é permitido. Simplifique.');
  try { return new RegExp(pattern, 'i'); } catch { return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
}
const tick = () => new Promise((r) => setImmediate(r));

function readText(abs) {
  const st = fs.statSync(abs);
  if (st.isDirectory()) throw new Error('É uma pasta; use list_dir.');
  if (st.size > MAX_READ) throw new Error(`Arquivo grande (${(st.size / 1e6).toFixed(1)} MB). Use search ou leia por linhas com start_line/end_line.`);
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`Arquivo binário (${st.size} bytes); não dá para ler como texto.`);
  return buf.toString('utf8');
}

// ctx: { root, checkpoint(relPath), setPlan(steps), signal, procs, webSearch }
async function execute(name, args, ctx) {
  const { root } = ctx;
  args = args || {};
  if (args._raw !== undefined) throw new Error('Os argumentos chegaram cortados (a resposta do modelo foi truncada). Divida em partes menores — por exemplo, crie o arquivo com um trecho e complete com edit_file.');
  switch (name) {
    case 'list_dir': {
      const abs = safePath(root, args.path);
      const items = fs.readdirSync(abs, { withFileTypes: true })
        .filter((e) => !IGNORE.has(e.name))
        .map((e) => (e.isDirectory() ? e.name + '/' : e.name));
      return items.sort().join('\n') || '(vazio)';
    }
    case 'read_file': {
      const abs = safePath(root, args.path);
      if (args.start_line || args.end_line) {
        const st = fs.statSync(abs);
        if (st.size > 50_000_000) throw new Error('Arquivo grande demais.');
        const lines = fs.readFileSync(abs, 'utf8').split('\n');
        const s = Math.max(1, args.start_line || 1);
        const e = Math.min(lines.length, args.end_line || lines.length);
        return clip(lines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join('\n'));
      }
      return clip(readText(abs));
    }
    case 'write_file': {
      const abs = safePath(root, args.path, { write: true });
      if (typeof args.content !== 'string') throw new Error('content precisa ser texto.');
      ctx.checkpoint(rel(root, abs));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, args.content);
      ctx.afterWrite?.(rel(root, abs));
      ctx.onFileChanged?.(rel(root, abs));
      return `Arquivo gravado: ${rel(root, abs)} (${args.content.split('\n').length} linhas)`;
    }
    case 'edit_file': {
      const abs = safePath(root, args.path, { write: true });
      const text = readText(abs);
      if (!args.old_text) throw new Error('old_text vazio.');
      const count = text.split(args.old_text).length - 1;
      if (count === 0) throw new Error('old_text não encontrado no arquivo. Leia o arquivo e tente de novo com o trecho exato.');
      if (count > 1) throw new Error(`old_text aparece ${count} vezes; inclua mais contexto para ficar único.`);
      ctx.checkpoint(rel(root, abs));
      fs.writeFileSync(abs, text.replace(args.old_text, () => args.new_text ?? ''));
      ctx.afterWrite?.(rel(root, abs));
      ctx.onFileChanged?.(rel(root, abs));
      return `Arquivo editado: ${rel(root, abs)}`;
    }
    case 'glob':
      return web.glob(root, String(args.pattern || '*'), walk);
    case 'search': {
      const re = safeRegex(args.pattern);
      const only = args.glob ? web.globToRegex(args.glob.includes('/') ? args.glob : `**/${args.glob}`) : null;
      const files = [];
      walk(safePath(root, args.path), files, 20000);
      const hits = [];
      const t0 = Date.now();
      for (let i = 0; i < files.length && hits.length < 100; i++) {
        if (i % 50 === 0) { await tick(); if (ctx.signal?.aborted) break; if (Date.now() - t0 > 20000) { hits.push('…[busca interrompida após 20 s; refine o padrão ou a pasta]'); break; } }
        const f = files[i];
        const r = rel(root, f);
        if (only && !only.test(r)) continue;
        let st; try { st = fs.statSync(f); } catch { continue; }
        if (st.size > 1_000_000) continue;
        const buf = fs.readFileSync(f);
        if (buf.subarray(0, 8000).includes(0)) continue;
        const lines = buf.toString('utf8').split('\n');
        for (let n = 0; n < lines.length && hits.length < 100; n++) {
          const line = lines[n].length > 2000 ? lines[n].slice(0, 2000) : lines[n];
          if (re.test(line)) hits.push(`${r}:${n + 1}: ${line.trim().slice(0, 200)}`);
        }
      }
      return hits.join('\n') || 'Nenhum resultado.';
    }
    case 'run_command': {
      if (!args.command) throw new Error('Informe o comando.');
      const r = await runCommand(root, args.command, Math.min(1800, args.timeout_sec || 120), ctx.signal);
      ctx.onFileChanged?.(null);
      return `$ ${args.command}\n[código de saída ${r.code}]\n${r.output}`;
    }
    case 'start_background': {
      if (!ctx.procs) throw new Error('Processos em segundo plano indisponíveis aqui.');
      const p = ctx.procs.start(args.command, { name: args.name, port: args.port });
      const ready = await ctx.procs.waitReady(p.id, 15000);
      return `Processo ${p.id} (${p.name}) iniciado, pid ${p.pid}. ${p.port ? `Porta ${p.port}: ${ready ? 'respondendo' : 'ainda não respondeu'}.` : 'Nenhuma porta detectada ainda.'}\nStatus: ${p.status}\n--- log ---\n${ctx.procs.read(p.id, 40)}`;
    }
    case 'read_process_log':
      if (!ctx.procs) throw new Error('Processos em segundo plano indisponíveis aqui.');
      return clip(`Status: ${ctx.procs.get(args.id).status}\n${ctx.procs.read(args.id, Math.min(500, args.lines || 80))}`);
    case 'stop_background':
      if (!ctx.procs) throw new Error('Processos em segundo plano indisponíveis aqui.');
      ctx.procs.stop(args.id);
      return `Processo ${args.id} encerrado.`;
    case 'list_processes': {
      const list = ctx.procs?.list() || [];
      return list.length ? list.map((p) => `${p.id} · ${p.status} · ${p.name}${p.port ? ` · porta ${p.port}` : ''}`).join('\n') : 'Nenhum processo em segundo plano.';
    }
    case 'fetch_url':
      return clip(await web.webFetch(String(args.url || ''), ctx.signal));
    case 'web_search':
      return clip(await web.webSearch(String(args.query || ''), ctx.webSearch || {}, ctx.signal));
    case 'repo_map':
      return require('./repomap').buildRepoMap(root);
    case 'update_plan': {
      ctx.setPlan?.(Array.isArray(args.steps) ? args.steps.slice(0, 50).map((s) => ({ title: String(s.title || '').slice(0, 200), status: ['pending', 'in_progress', 'done'].includes(s.status) ? s.status : 'pending' })) : []);
      return 'Plano atualizado.';
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

module.exports = { DEFS, READ_ONLY, execute, needsApproval, safePath, runCommand, walk, IGNORE, safeRegex };
