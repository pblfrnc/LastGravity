// Mapa do repositório: visão estrutural do projeto, com arquivos ordenados por importância
// (PageRank sobre o grafo de imports) e os principais símbolos de cada um.
const fs = require('fs');
const path = require('path');
const { walk } = require('./tools');

const CODE = /\.(js|mjs|cjs|jsx|ts|tsx|py|dart|go|rs|java|kt|swift|rb|php|cs|c|cc|cpp|h|hpp|vue|svelte)$/i;
const SYMBOLS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:abstract\s+|final\s+|public\s+|data\s+|sealed\s+)*class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)/,
  /^\s*(?:mixin|extension)\s+([A-Za-z_]\w*)/,
];
const IMPORTS = [
  /(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*from\s+([\w.]+)\s+import/gm,
  /^\s*import\s+([\w.]+)/gm,
];
const stem = (p) => path.basename(p).replace(/\.[^.]+$/, '').toLowerCase();

const cache = new Map(); // evita reler o projeto a cada tarefa (vale 60 s)
function buildRepoMap(root, opts = {}) {
  const key = `${root}|${opts.maxFiles}|${opts.maxChars}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 60000) return hit.text;
  const text = computeRepoMap(root, opts);
  cache.set(key, { t: Date.now(), text });
  return text;
}

function computeRepoMap(root, { maxFiles = 50, maxChars = 6000 } = {}) {
  const all = [];
  walk(root, all, 2000);
  const files = all.filter((f) => CODE.test(f)).filter((f) => { try { return fs.statSync(f).size < 300_000; } catch { return false; } });
  if (!files.length) return 'Nenhum arquivo de código encontrado.';

  const byStem = new Map();
  for (const f of files) { const s = stem(f); if (!byStem.has(s)) byStem.set(s, []); byStem.get(s).push(f); }
  const info = new Map();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const syms = [];
    for (const line of text.split('\n')) {
      if (syms.length >= 12) break;
      for (const re of SYMBOLS) { const m = line.match(re); if (m && !syms.includes(m[1])) { syms.push(m[1]); break; } }
    }
    const deps = new Set();
    for (const re of IMPORTS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const spec = m[1].split(/[/.]/).filter(Boolean).pop()?.toLowerCase();
        for (const target of byStem.get(spec) || []) if (target !== f) deps.add(target);
      }
    }
    info.set(f, { syms, deps: [...deps] });
  }

  // PageRank simples
  const N = files.length, d = 0.85;
  let pr = new Map(files.map((f) => [f, 1 / N]));
  for (let it = 0; it < 20; it++) {
    const next = new Map(files.map((f) => [f, (1 - d) / N]));
    let dangling = 0;
    for (const f of files) {
      const out = info.get(f).deps;
      if (!out.length) { dangling += pr.get(f); continue; }
      for (const t of out) next.set(t, next.get(t) + (d * pr.get(f)) / out.length);
    }
    for (const f of files) next.set(f, next.get(f) + (d * dangling) / N);
    pr = next;
  }

  const ranked = [...files].sort((a, b) => pr.get(b) - pr.get(a)).slice(0, maxFiles);
  let out = `Mapa do repositório (${files.length} arquivos de código; os mais centrais primeiro)\n`;
  for (const f of ranked) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    const { syms, deps } = info.get(f);
    const line = `\n${rel}${deps.length ? `  → usa ${deps.length}` : ''}${syms.length ? `\n  ${syms.join(', ')}` : ''}`;
    if (out.length + line.length > maxChars) { out += '\n…'; break; }
    out += line;
  }
  return out;
}

module.exports = { buildRepoMap };
