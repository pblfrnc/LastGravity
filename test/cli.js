// Testa a CLI: run (primeiro plano), trust, agents, --continue, --bg + ps + logs.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgcli-'));
const dir = path.join(tmp, 'p'); fs.mkdirSync(dir);
const env = { ...process.env, LASTGRAVITY_HOME: path.join(tmp, 'home'), MYFRIENDS_HOME: path.join(tmp, 'friends') };
const BIN = path.join(__dirname, '..', 'bin', 'lastgravity.js');
const lg = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: dir, env, encoding: 'utf8', input: '', timeout: 60000 });

let r = lg('run', 'crie hello', '--provider', 'mock');
assert.strictEqual(r.status, 0, r.stderr);
assert.match(r.stdout, /rejeitado automaticamente/);
assert.ok(fs.existsSync(path.join(dir, 'hello.txt')));
console.log('✓ run em primeiro plano (sem terminal, comandos são rejeitados)');

assert.match(lg('trust').stdout, /confiável/);
r = lg('run', 'de novo', '--provider', 'mock', '--approval', 'auto');
assert.match(r.stdout, /Olá do LastGravity|cat hello\.txt/);
assert.doesNotMatch(r.stdout, /rejeitado/);
console.log('✓ trust + modo autônomo');

r = lg('agents');
assert.strictEqual((r.stdout.match(/agt_/g) || []).length, 2);
r = lg('run', '--continue', 'mais', '--approval', 'auto');
assert.strictEqual(r.status, 0);
console.log('✓ agents e --continue');

r = lg('run', 'em segundo plano', '--provider', 'mock', '--approval', 'auto', '--bg');
const id = (r.stdout.match(/segundo plano: (\S+)/) || [])[1];
assert.ok(id, r.stdout);
const t0 = Date.now();
while (Date.now() - t0 < 20000 && !/concluído/.test(lg('ps').stdout)) spawnSync('sleep', ['0.5']);
assert.match(lg('ps').stdout, /concluído/);
assert.match(lg('logs', id).stdout, /Resumo/);
console.log('✓ --bg, ps e logs');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nCLI OK.');
