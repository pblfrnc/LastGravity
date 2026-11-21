// Empacota a extensão do VS Code (.vsix) com uma cópia do servidor do LastGravity dentro.
// Uso: node scripts/build-vscode.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const ext = path.join(root, 'vscode-extension');
const srv = path.join(ext, 'server');
fs.rmSync(srv, { recursive: true, force: true });
fs.mkdirSync(srv, { recursive: true });
for (const d of ['bin', 'src', 'public', 'skills']) fs.cpSync(path.join(root, d), path.join(srv, d), { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(srv, 'package.json'));
fs.writeFileSync(path.join(ext, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 LastGravity\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n');
if (!fs.existsSync(path.join(ext, 'README.md'))) fs.writeFileSync(path.join(ext, 'README.md'), '# LastGravity para VS Code\n\nAgentes de IA que planejam, editam, rodam comandos e verificam o próprio trabalho — com Claude, Gemini, OpenAI, OpenRouter ou Ollama (grátis, local).\n\n- **LastGravity: Abrir central de controle** — o Editor e o Gerenciador de agentes num painel.\n- **LastGravity: Nova tarefa** (⌘⌥L) — cria um agente.\n- Clique direito numa seleção → **Pedir ao agente sobre a seleção**.\n\nAs chaves de API ficam só no seu computador (~/.lastgravity).\n');
const pkg = JSON.parse(fs.readFileSync(path.join(ext, 'package.json'), 'utf8'));
pkg.version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(ext, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
execSync('npx --yes @vscode/vsce@latest package --no-dependencies --allow-missing-repository --skip-license -o ../dist/', { cwd: ext, stdio: 'inherit' });
console.log('\n✅ Extensão gerada em dist/');
