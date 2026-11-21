// Copia o editor Monaco para public/vendor/vs, para o app funcionar offline.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'monaco-editor', 'min', 'vs');
const dst = path.join(__dirname, '..', 'public', 'vendor', 'vs');
if (!fs.existsSync(src)) {
  console.log('monaco-editor não instalado; o editor usará a CDN.');
  process.exit(0);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('Monaco copiado para public/vendor/vs');
