#!/usr/bin/env node
// Servidor MCP falso para testes: stdio, JSON-RPC 2.0 delimitado por nova linha.
// Ferramentas: echo (paginada em duas páginas junto com "soma") e falha (isError).
const readline = require('readline');
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const TOOLS = [
  { name: 'echo', description: 'Devolve o texto recebido.', inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'soma', description: 'Soma a e b.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
  { name: 'falha', description: 'Sempre falha.', inputSchema: { type: 'object' } },
];
process.stderr.write('fake-mcp iniciado\n');
if (process.env.FAKE_MCP_TOKEN) process.stderr.write(`token recebido (${process.env.FAKE_MCP_TOKEN.length} caracteres)\n`);
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const m = JSON.parse(line);
  if (m.id === undefined) return; // notificações
  const ok = (result) => send({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize':
      return ok({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '1.0.0' } });
    case 'tools/list':
      if (!m.params?.cursor) return ok({ tools: TOOLS.slice(0, 1), nextCursor: 'p2' });
      return ok({ tools: TOOLS.slice(1) });
    case 'tools/call': {
      const { name, arguments: a = {} } = m.params;
      if (name === 'echo') return ok({ content: [{ type: 'text', text: `eco: ${a.text}` }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] });
      if (name === 'soma') return ok({ content: [{ type: 'text', text: String(a.a + a.b) }] });
      if (name === 'falha') return ok({ content: [{ type: 'text', text: 'deu errado' }], isError: true });
      return send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `Ferramenta desconhecida: ${name}` } });
    }
    default:
      return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Método não encontrado' } });
  }
});
