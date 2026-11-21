// Skills: pastas com SKILL.md (frontmatter YAML simples com name/description + instruções)
// e arquivos de apoio. Locais: global (~/.lastgravity/skills) e do projeto (<raiz>/.lastgravity/skills).
// O agente vê só nome + descrição no prompt e carrega o conteúdo completo com a ferramenta use_skill.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_FILE = 200_000;
const MAX_LIST = 200;

const dirs = (root) => ({
  global: path.join(config.DIR, 'skills'),
  project: path.join(root, '.lastgravity', 'skills'),
});

const unquote = (v) => {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    const inner = v.slice(1, -1);
    return v[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n') : inner.replace(/''/g, "'");
  }
  return v;
};

// Parser de frontmatter mínimo: pares "chave: valor" de primeiro nível, valores entre aspas,
// blocos "|" / ">" e continuação por indentação. Chaves aninhadas são ignoradas.
function parseFrontmatter(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = src.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(\n|$)/);
  if (!m) return { data: {}, body: src };
  const data = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].replace(/\s+#.*$/, (c) => (/^["']/.test(kv[2].trim()) ? c : ''));
    const block = value.trim().match(/^([|>])[-+]?$/);
    const cont = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || (block && lines[i + 1].trim() === ''))) cont.push(lines[++i]);
    if (block) {
      const indent = Math.min(...cont.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length), Infinity);
      const body = cont.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
      value = block[1] === '|' ? body.join('\n').trim() : body.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ').trim();
    } else if (cont.length && value.trim() === '') {
      continue; // mapa/lista aninhado: ignorado
    } else {
      value = [value, ...cont.map((l) => l.trim())].join(' ');
      value = unquote(value);
    }
    data[key] = value;
  }
  return { data, body: src.slice(m[0].length) };
}

function quoteYaml(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return /^[\w\s.,()/áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ-]*$/.test(s) && !/^[-?\s]/.test(s) && s ? s : JSON.stringify(s);
}

function buildSkillMd({ name, description, body }) {
  return `---\nname: ${name}\ndescription: ${quoteYaml(description)}\n---\n\n${String(body || '').trim()}\n`;
}

function listFiles(dir, base = dir, out = [], depth = 0) {
  if (depth > 4 || out.length >= MAX_LIST) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_LIST) break;
    if (e.name === '.DS_Store' || e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, base, out, depth + 1);
    else if (e.isFile()) { const r = path.relative(base, full).split(path.sep).join('/'); if (r !== 'SKILL.md') out.push(r); }
  }
  return out;
}

function readSkillDir(dir, scope, folder, disabled) {
  const file = path.join(dir, 'SKILL.md');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const { data } = parseFrontmatter(text);
  const name = String(data.name || folder).trim() || folder;
  return {
    name, folder, scope,
    description: String(data.description || '').trim(),
    path: dir, file,
    active: !disabled.includes(name),
  };
}

// Lista todas as skills; quando o mesmo nome existe nos dois locais, a do projeto prevalece.
function list(root, cfg) {
  const disabled = cfg?.skills?.disabled || [];
  const out = [];
  for (const [scope, base] of Object.entries(dirs(root))) {
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const s = readSkillDir(path.join(base, e.name), scope, e.name, disabled);
      if (s) out.push(s);
    }
  }
  const projectNames = new Set(out.filter((s) => s.scope === 'project').map((s) => s.name));
  for (const s of out) if (s.scope === 'global' && projectNames.has(s.name)) { s.shadowed = true; }
  return out.sort((a, b) => a.name.localeCompare(b.name) || (a.scope === 'project' ? -1 : 1));
}

// includeProject=false (pasta não confiável): ignora skills que vieram dentro do projeto.
const active = (root, cfg, { includeProject = true } = {}) => list(root, cfg).filter((s) => s.active && (includeProject ? !s.shadowed : s.scope === 'global'));

function checkScope(scope) {
  if (scope !== 'global' && scope !== 'project') throw Object.assign(new Error('Escopo inválido (use "global" ou "project").'), { status: 400 });
}
function checkFolder(folder) {
  if (!folder || !/^[\w.-]+$/.test(folder) || folder.startsWith('.')) throw Object.assign(new Error('Nome de skill inválido.'), { status: 400 });
}
function skillDir(root, scope, folder) {
  checkScope(scope); checkFolder(folder);
  return path.join(dirs(root)[scope], folder);
}

function create(root, { name, description, body, scope = 'project' }) {
  checkScope(scope);
  name = String(name || '').trim();
  if (!NAME_RE.test(name) || name.length > 64) throw Object.assign(new Error('Nome inválido: use kebab-case (letras minúsculas, números e hífens, ex.: "revisar-codigo"), até 64 caracteres.'), { status: 400 });
  if (!String(description || '').trim()) throw Object.assign(new Error('Escreva uma descrição: é ela que diz ao agente quando usar a skill.'), { status: 400 });
  const dir = skillDir(root, scope, name);
  if (fs.existsSync(dir)) throw Object.assign(new Error(`Já existe uma skill "${name}" (${scope === 'global' ? 'global' : 'do projeto'}).`), { status: 409 });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), buildSkillMd({ name, description, body }));
  return readSkillDir(dir, scope, name, []);
}

function read(root, scope, folder) {
  const dir = skillDir(root, scope, folder);
  const file = path.join(dir, 'SKILL.md');
  const content = fs.readFileSync(file, 'utf8');
  return { scope, folder, path: dir, file, content, files: listFiles(dir) };
}

function write(root, scope, folder, content) {
  const dir = skillDir(root, scope, folder);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw Object.assign(new Error('Skill não encontrada.'), { status: 404 });
  if (typeof content !== 'string') throw Object.assign(new Error('Conteúdo inválido.'), { status: 400 });
  if (!parseFrontmatter(content).data.description) throw Object.assign(new Error('O SKILL.md precisa de um frontmatter com "description".'), { status: 400 });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return read(root, scope, folder);
}

function remove(root, scope, folder) {
  const dir = skillDir(root, scope, folder);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw Object.assign(new Error('Skill não encontrada.'), { status: 404 });
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}

// Bloco do system prompt com as skills ativas (só nome + descrição).
function promptSection(root, cfg, opts = {}) {
  const list = active(root, cfg, opts);
  if (!list.length) return '';
  return `\n\n<skills>\nSkills are packaged instructions for specific kinds of tasks. When the user's request matches a skill's description, call use_skill with its name BEFORE starting, and follow the instructions it returns.\n${list.map((s) => `- ${s.name}: ${s.description || '(sem descrição)'}`).join('\n')}\n</skills>`;
}

const USE_SKILL_DEF = {
  name: 'use_skill',
  description: 'Carrega as instruções completas de uma skill (listada em <skills> no prompt) e a lista dos seus arquivos de apoio. Com "file", lê um arquivo de apoio da pasta da skill.',
  parameters: { type: 'object', properties: { name: { type: 'string', description: 'Nome da skill' }, file: { type: 'string', description: 'Opcional: caminho relativo de um arquivo de apoio dentro da pasta da skill' } }, required: ['name'] },
};

function useSkill(root, cfg, args = {}, opts = {}) {
  const wanted = String(args.name || '').trim();
  const all = active(root, cfg, opts);
  const s = all.find((x) => x.name === wanted) || all.find((x) => x.folder === wanted);
  if (!s) {
    const off = list(root, cfg).find((x) => x.name === wanted || x.folder === wanted);
    throw new Error(off ? `A skill "${wanted}" está desativada.` : `Skill não encontrada: "${wanted}". Disponíveis: ${all.map((x) => x.name).join(', ') || '(nenhuma)'}.`);
  }
  if (args.file) {
    const abs = path.resolve(s.path, String(args.file));
    if (!abs.startsWith(s.path + path.sep)) throw new Error('Arquivo fora da pasta da skill.');
    let real;
    try { real = fs.realpathSync(abs); } catch { throw new Error(`Arquivo não encontrado na skill: ${args.file}`); }
    const realBase = fs.realpathSync(s.path);
    if (real !== realBase && !real.startsWith(realBase + path.sep)) throw new Error('Arquivo fora da pasta da skill.');
    const st = fs.statSync(real);
    if (!st.isFile()) throw new Error('Não é um arquivo.');
    if (st.size > MAX_FILE) throw new Error(`Arquivo grande demais (${st.size} bytes).`);
    const text = fs.readFileSync(real, 'utf8');
    if (text.includes('\u0000')) throw new Error('Arquivo binário.');
    return text;
  }
  const content = fs.readFileSync(s.file, 'utf8');
  const files = listFiles(s.path);
  let footer = '';
  if (files.length) {
    const relToRoot = path.relative(root, s.path).split(path.sep).join('/');
    const insideProject = !relToRoot.startsWith('..') && !path.isAbsolute(relToRoot);
    footer = `\n\n---\nArquivos de apoio desta skill (${s.scope === 'global' ? 'global' : 'do projeto'}):\n${files.map((f) => `- ${f}`).join('\n')}\n` +
      (insideProject
        ? `Leia-os com read_file (caminho "${relToRoot}/<arquivo>") ou com use_skill {"name": "${s.name}", "file": "<arquivo>"}.`
        : `Leia-os com use_skill {"name": "${s.name}", "file": "<arquivo>"}.`);
  }
  return `# Skill: ${s.name}\n(pasta: ${s.path})\n\n${content}${footer}`;
}

module.exports = { parseFrontmatter, buildSkillMd, list, active, create, read, write, remove, promptSection, useSkill, USE_SKILL_DEF, dirs, NAME_RE };
