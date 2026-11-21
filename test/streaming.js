// Testa os leitores de streaming (SSE) dos três formatos de API com servidores falsos.
const http = require('http');
const assert = require('assert');

function fake(chunks, { status = 200 } = {}) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        srv.lastBody = JSON.parse(body || '{}');
        srv.lastUrl = req.url;
        if (status !== 200) { res.writeHead(status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'chave inválida' } })); }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const c of chunks) { res.write(c); await new Promise((r) => setTimeout(r, 5)); }
        res.end();
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const ev = (obj, event) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(obj)}\n\n`;
const TOOLS = [{ name: 'read_file', description: 'x', parameters: { type: 'object', properties: { path: { type: 'string' } } } }];
const MSGS = [{ role: 'user', content: 'oi' }];

(async () => {
  // Anthropic: texto + tool_use com JSON em pedaços, dividido no meio de um evento
  let s = await fake([
    ev({ type: 'message_start', message: { usage: { input_tokens: 42, output_tokens: 1 } } }, 'message_start'),
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'content_block_start'),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Vou ' } }, 'content_block_delta'),
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ler."}}',
    '\n\n',
    ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'read_file', input: {} } }, 'content_block_start'),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pa' } }, 'content_block_delta'),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'th":"a.js"}' } }, 'content_block_delta'),
    ev({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 17 } }, 'message_delta'),
    ev({ type: 'message_stop' }, 'message_stop'),
  ]);
  let streamed = '';
  let r = await require('../src/providers/anthropic').chat({ cfg: { apiKey: 'k', baseUrl: `http://127.0.0.1:${s.address().port}` }, model: 'm', system: 's', messages: MSGS, tools: TOOLS, onText: (t) => (streamed += t) });
  assert.strictEqual(r.text, 'Vou ler.'); assert.strictEqual(streamed, 'Vou ler.');
  assert.deepStrictEqual(r.toolCalls, [{ id: 'tu_1', name: 'read_file', args: { path: 'a.js' } }]);
  assert.deepStrictEqual(r.usage, { input: 42, output: 17 });
  assert.strictEqual(s.lastBody.stream, true);
  s.close();
  console.log('✓ streaming Anthropic (texto + tool_use em pedaços + usage)');

  // OpenAI-compatível: duas tool calls intercaladas por índice + usage no fim + [DONE]
  s = await fake([
    ev({ choices: [{ delta: { role: 'assistant', content: 'Ok' } }] }),
    ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'read_file', arguments: '' } }] } }] }),
    ev({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":' } }] } }] }),
    ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"x"}' } }] } }] }),
    ev({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '"y"}' } }] } }] }),
    ev({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ev({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    'data: [DONE]\n\n',
  ]);
  streamed = '';
  r = await require('../src/providers/openai').chat({ cfg: { apiKey: 'k', baseUrl: `http://127.0.0.1:${s.address().port}/v1` }, model: 'm', system: 's', messages: MSGS, tools: TOOLS, onText: (t) => (streamed += t) });
  assert.strictEqual(r.text, 'Ok'); assert.strictEqual(streamed, 'Ok');
  assert.deepStrictEqual(r.toolCalls, [{ id: 'c1', name: 'read_file', args: { path: 'x' } }, { id: 'c2', name: 'read_file', args: { path: 'y' } }]);
  assert.deepStrictEqual(r.usage, { input: 10, output: 5 });
  assert.strictEqual(s.lastUrl, '/v1/chat/completions');
  s.close();
  console.log('✓ streaming OpenAI (2 tool calls intercaladas + usage)');

  // OpenAI-compatível sem chave em servidor local (Ollama) e sem ferramentas: não envia tools
  s = await fake([ev({ choices: [{ delta: { content: 'ok' } }] }), 'data: [DONE]\n\n']);
  r = await require('../src/providers/openai').chat({ cfg: { apiKey: '', baseUrl: `http://localhost:${s.address().port}/v1` }, model: 'm', system: 's', messages: MSGS, tools: [] });
  assert.strictEqual(r.text, 'ok'); assert.ok(!('tools' in s.lastBody));
  s.close();
  console.log('✓ servidor local sem chave e sem ferramentas');

  // Gemini: texto em partes + functionCall com thoughtSignature preservada
  s = await fake([
    ev({ candidates: [{ content: { role: 'model', parts: [{ text: 'Lendo ' }] } }] }),
    ev({ candidates: [{ content: { role: 'model', parts: [{ text: 'o arquivo.' }, { functionCall: { name: 'read_file', args: { path: 'z' } }, thoughtSignature: 'SIG' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, thoughtsTokenCount: 2 } }),
    ev({ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }] }),
  ]);
  streamed = '';
  r = await require('../src/providers/gemini').chat({ cfg: { apiKey: 'k', baseUrl: `http://127.0.0.1:${s.address().port}` }, model: 'gemini-x', system: 's', messages: MSGS, tools: TOOLS, onText: (t) => (streamed += t) });
  assert.strictEqual(r.text, 'Lendo o arquivo.'); assert.strictEqual(streamed, r.text);
  assert.strictEqual(r.toolCalls[0].name, 'read_file'); assert.deepStrictEqual(r.toolCalls[0].args, { path: 'z' });
  assert.ok(r.raw.gemini.some((p) => p.thoughtSignature === 'SIG'));
  assert.deepStrictEqual(r.usage, { input: 7, output: 5 });
  assert.ok(s.lastUrl.includes(':streamGenerateContent?alt=sse'));
  s.close();
  console.log('✓ streaming Gemini (texto + functionCall + thoughtSignature)');

  // Erros: HTTP 401 com mensagem clara; servidor desligado com mensagem amigável
  s = await fake([], { status: 401 });
  await assert.rejects(require('../src/providers/anthropic').chat({ cfg: { apiKey: 'k', baseUrl: `http://127.0.0.1:${s.address().port}` }, model: 'm', system: 's', messages: MSGS, tools: [] }), /401: chave inválida/);
  s.close();
  const { friendlyError } = require('../src/providers/util');
  const err = await require('../src/providers/openai').chat({ cfg: { baseUrl: 'http://localhost:1/v1' }, model: 'm', system: 's', messages: MSGS, tools: [] }).catch((e) => e);
  assert.match(friendlyError(err, 'http://localhost:1/v1'), /programa local/);
  console.log('✓ erros HTTP e de conexão com mensagens claras');

  // Respostas cortadas no meio são detectadas (e marcadas para nova tentativa)
  const A = require('../src/providers/anthropic'), O = require('../src/providers/openai'), G = require('../src/providers/gemini');
  s = await fake([ev({ type: 'message_start', message: { usage: { input_tokens: 1 } } }), ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'meio' } })]);
  let e1 = await A.chat({ cfg: { apiKey: 'k', baseUrl: `http://127.0.0.1:${s.address().port}` }, model: 'm', system: 's', messages: MSGS, tools: [] }).catch((e) => e);
  assert.ok(e1.retryable && /meio da resposta/.test(e1.message)); s.close();
  s = await fake([ev({ choices: [{ delta: { content: 'meio' } }] })]);
  e1 = await O.chat({ cfg: { apiKey: 'k', baseUrl: `http://127.0.0.1:${s.address().port}/v1` }, model: 'm', system: 's', messages: MSGS, tools: [] }).catch((e) => e);
  assert.ok(e1.retryable); s.close();
  s = await fake([ev({ candidates: [{ content: { parts: [{ text: 'meio' }] } }] })]);
  e1 = await G.chat({ cfg: { apiKey: 'k', baseUrl: `http://127.0.0.1:${s.address().port}` }, model: 'g', system: 's', messages: MSGS, tools: [] }).catch((e) => e);
  assert.ok(e1.retryable); s.close();
  // max_tokens / length viram stopReason 'max_tokens'
  s = await fake([ev({ choices: [{ delta: { content: 'x' } }] }), ev({ choices: [{ delta: {}, finish_reason: 'length' }] }), 'data: [DONE]\n\n']);
  r = await O.chat({ cfg: { apiKey: 'k', baseUrl: `http://127.0.0.1:${s.address().port}/v1` }, model: 'm', system: 's', messages: MSGS, tools: [] });
  assert.strictEqual(r.stopReason, 'max_tokens'); s.close();
  console.log('✓ resposta cortada detectada nos três formatos; limite de tokens sinalizado');

  // Vigia de inatividade: servidor que para de mandar dados não trava o agente
  process.env.LASTGRAVITY_STREAM_IDLE_MS = '400';
  const hang = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(ev({ choices: [{ delta: { content: 'oi' } }] })); });
  await new Promise((ok) => hang.listen(0, '127.0.0.1', ok));
  const t0 = Date.now();
  e1 = await O.chat({ cfg: { apiKey: 'k', baseUrl: `http://127.0.0.1:${hang.address().port}/v1` }, model: 'm', system: 's', messages: MSGS, tools: [] }).catch((e) => e);
  assert.ok(e1.retryable && /parou de responder/.test(e1.message) && Date.now() - t0 < 3000);
  hang.closeAllConnections(); hang.close(); delete process.env.LASTGRAVITY_STREAM_IDLE_MS;
  console.log('✓ conexão parada é abortada pelo vigia');

  // Imagens nos três formatos + cache de prompt na Anthropic
  const IM = [{ role: 'user', content: 'o que é isso?', images: [{ mediaType: 'image/png', data: 'AAAA' }] }];
  assert.strictEqual(A.convert(IM)[0].content[0].type, 'image');
  assert.strictEqual(O.convert('s', IM)[1].content[1].image_url.url, 'data:image/png;base64,AAAA');
  assert.ok(G.convert(IM)[0].parts[0].inlineData);
  s = await fake([ev({ type: 'message_start', message: { usage: { input_tokens: 5, cache_read_input_tokens: 100 } } }), ev({ type: 'message_stop' })]);
  r = await A.chat({ cfg: { apiKey: 'k', baseUrl: `http://127.0.0.1:${s.address().port}` }, model: 'm', system: 'sys', messages: MSGS, tools: TOOLS });
  assert.strictEqual(s.lastBody.system[0].cache_control.type, 'ephemeral'); assert.ok(s.lastBody.tools.at(-1).cache_control);
  assert.strictEqual(r.usage.input, 105); s.close();
  console.log('✓ imagens (Anthropic/OpenAI/Gemini) e cache de prompt');

  // Ollama nativo: NDJSON, num_ctx enviado, tool_calls com argumentos em objeto
  const ol = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      ol.lastBody = JSON.parse(b); ol.lastUrl = req.url;
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(JSON.stringify({ message: { role: 'assistant', content: 'Vou ' } }) + '\n');
      res.write(JSON.stringify({ message: { role: 'assistant', content: 'ler.', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'q' } } }] } }) + '\n');
      res.end(JSON.stringify({ done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 4 }) + '\n');
    });
  });
  await new Promise((ok) => ol.listen(0, '127.0.0.1', ok));
  r = await require('../src/providers/ollama').chat({ cfg: { baseUrl: `http://localhost:${ol.address().port}/v1`, numCtx: 65536 }, model: 'qwen', system: 's', messages: MSGS, tools: TOOLS });
  assert.strictEqual(ol.lastUrl, '/api/chat'); assert.strictEqual(ol.lastBody.options.num_ctx, 65536);
  assert.strictEqual(r.text, 'Vou ler.'); assert.deepStrictEqual(r.toolCalls[0].args, { path: 'q' }); assert.deepStrictEqual(r.usage, { input: 9, output: 4 });
  ol.close();
  console.log('✓ Ollama nativo (num_ctx, NDJSON, ferramentas)');

  console.log('\nStreaming OK.');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
