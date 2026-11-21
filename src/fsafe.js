// Confinamento de caminhos à pasta do projeto, resistente a symlinks.
const fs = require('fs');
const path = require('path');

const realRoots = new Map();
function realRoot(root) {
  if (!realRoots.has(root)) { let r = root; try { r = fs.realpathSync.native(root); } catch {} realRoots.set(root, r); }
  return realRoots.get(root);
}
const caseless = process.platform === 'win32' || process.platform === 'darwin';
function inside(base, p) {
  const a = caseless ? base.toLowerCase() : base, b = caseless ? p.toLowerCase() : p;
  return b === a || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
}

// Resolve o caminho real do arquivo (ou do ancestral mais próximo que exista, para arquivos novos).
function realOf(abs) {
  let cur = abs;
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...tail.reverse()); }
    catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * Devolve o caminho absoluto dentro do projeto, ou lança erro.
 * opts.write: recusa gravar através de um symlink.
 */
function safePath(root, p, opts = {}) {
  const abs = path.resolve(root, p || '.');
  if (!inside(root, abs)) throw new Error(`Caminho fora do projeto: ${p}`);
  const real = realOf(abs);
  if (!inside(realRoot(root), real)) throw new Error(`Caminho aponta para fora do projeto (atalho/symlink): ${p}`);
  if (opts.write) {
    try { if (fs.lstatSync(abs).isSymbolicLink()) throw new Error(`Não gravo através de atalho/symlink: ${p}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return abs;
}

module.exports = { safePath, inside, realRoot };
