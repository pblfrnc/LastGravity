// Provedor simulado: permite testar a IDE inteira sem chave de API.
// Roteiro fixo: plano → lista arquivos → cria hello.txt → roda comando → resumo (com streaming).
// Roteiros extras para testes: "mcp: …", "skill: …", "friends: …" e "friends-task: …".
const { newId } = require('./util');

async function stream(text, onText) {
  for (const chunk of text.match(/.{1,6}/gs) || []) { onText?.(chunk); await new Promise((r) => setTimeout(r, 15)); }
}

async function chat({ messages, tools, onText }) {
  await new Promise((r) => setTimeout(r, 200));
  if (!tools.length) { await stream('ok', onText); return { text: 'ok', toolCalls: [], usage: { input: 10, output: 1 } }; }
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
  const toolTurns = messages.slice(lastUserIdx).filter((m) => m.role === 'tool').length;
  const lastUser = messages[lastUserIdx]?.content || '';
  const call = (name, args) => ({ text: '', toolCalls: [{ id: newId(), name, args }], usage: { input: 100, output: 20 } });
  // Roteiros extras (testes): "mcp: <texto>" chama a primeira ferramenta MCP; "skill: <nome>" chama use_skill.
  const extra = lastUser.match(/^(mcp|skill):\s*([\s\S]*)$/);
  if (extra) {
    if (toolTurns === 0) {
      if (extra[1] === 'skill') return call('use_skill', { name: extra[2].trim() });
      const t = tools.find((x) => x.name.startsWith('mcp__') && x.name.endsWith('__echo')) || tools.find((x) => x.name.startsWith('mcp__'));
      if (t) return call(t.name, { text: extra[2].trim() });
    }
    const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
    const t = lastTool ? `Resultado: ${lastTool.results[0]?.output}` : 'Nenhuma ferramenta MCP disponível.';
    await stream(t, onText);
    return { text: t, toolCalls: [], usage: { input: 100, output: 10 } };
  }
  // "friends: <texto>" envia a mensagem pelo MyFriends e lê a sala; "friends-task: <texto>" pede um trabalho (task).
  const fr = lastUser.match(/^friends(-task)?:\s*([\s\S]*)$/);
  if (fr && tools.some((x) => x.name === 'friends_send')) {
    if (toolTurns === 0) return call('friends_send', { text: fr[2].trim(), type: fr[1] ? 'task' : 'chat' });
    if (toolTurns === 1) return call('friends_read', {});
    const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
    const t = `MyFriends: ${String(lastTool?.results[0]?.output || '').slice(0, 300)}`;
    await stream(t, onText);
    return { text: t, toolCalls: [], usage: { input: 100, output: 10 } };
  }
  switch (toolTurns % 5) {
    case 0: {
      const t = 'Vou explorar o projeto primeiro.';
      await stream(t, onText);
      return { ...call('update_plan', { steps: [{ title: 'Explorar o projeto', status: 'in_progress' }, { title: 'Criar hello.txt', status: 'pending' }, { title: 'Verificar', status: 'pending' }] }), text: t };
    }
    case 1: return call('list_dir', { path: '.' });
    case 2: return call('write_file', { path: 'hello.txt', content: `Olá do LastGravity!\nPedido: ${lastUser}\n` });
    case 3: return call('run_command', { command: process.platform === 'win32' ? 'type hello.txt' : 'cat hello.txt' });
    default: {
      const t = '## Resumo\nCriei `hello.txt` e verifiquei o conteúdo com um comando. (Provedor simulado.)';
      await stream(t, onText);
      return { text: t, toolCalls: [], usage: { input: 100, output: 30 } };
    }
  }
}

async function listModels() { return ['mock']; }

module.exports = { chat, listModels };
