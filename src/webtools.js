// Ferramentas de busca de arquivos por padrão (glob) e de web (busca e leitura de páginas).
const fs = require('fs');
const path = require('path');

/* ---------- glob ---------- */
function globToRegex(glob) {
  let re = '';
  let i = 0;
  const g = glob.replace(/^\.\//, '');
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 3 : 2; continue; }
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = g.indexOf('}', i); if (end > i) { re += `(?:${g.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`; i = end + 1; continue; } re += '\\{'; }
    else re += /[.+^$()|[\]\\]/.test(c) ? `\\${c}` : c;
    i++;
  }
  return new RegExp(`^${re}$`, process.platform === 'win32' || process.platform === 'darwin' ? 'i' : '');
}
function glob(root, pattern, walk) {
  const files = [];
  walk(root, files, 20000);
  const re = globToRegex(pattern.includes('/') ? pattern : `**/${pattern}`);
  const hits = files.map((f) => path.relative(root, f).split(path.sep).join('/')).filter((r) => re.test(r));
  const withTime = hits.map((r) => { let t = 0; try { t = fs.statSync(path.join(root, r)).mtimeMs; } catch {} return [r, t]; });
  withTime.sort((a, b) => b[1] - a[1]);
  const list = withTime.slice(0, 300).map(([r]) => r);
  return list.length ? `${hits.length} arquivo(s)${hits.length > 300 ? ' (mostrando 300, mais recentes primeiro)' : ''}:\n${list.join('\n')}` : 'Nenhum arquivo encontrado.';
}

/* ---------- HTML → texto ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', copy: '©' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
function htmlToText(html, baseUrl) {
  let s = html.replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const title = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const body = (s.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || s;
  s = body
    .replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, text) => {
      const t = text.replace(/<[^>]+>/g, '').trim();
      let u = href; try { u = new URL(href, baseUrl).href; } catch {}
      return t ? `${t} (${u})` : '';
    })
    .replace(/<h([1-6])[^>]*>/gi, (m, n) => `\n\n${'#'.repeat(Number(n))} `)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|h[1-6]|ul|ol|table|pre|blockquote|header|footer|nav)>/gi, '\n')
    .replace(/<t[dh][^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  s = decode(s).replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return (title ? `# ${decode(title.trim())}\n\n` : '') + s;
}

/* ---------- web_fetch ---------- */
async function webFetch(url, signal) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Use uma URL http(s).');
  const ctl = AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(30000)].filter(Boolean)) : signal;
  const res = await fetch(url, { signal: ctl, headers: { 'user-agent': 'Mozilla/5.0 (LastGravity)', accept: 'text/html,application/json,text/plain,*/*' }, redirect: 'follow' });
  const type = res.headers.get('content-type') || '';
  const reader = res.body?.getReader();
  const chunks = []; let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length; chunks.push(value);
    if (size > 3_000_000) { reader.cancel(); break; }
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let text = raw;
  if (/html/i.test(type) || /^\s*<(!doctype|html)/i.test(raw)) text = htmlToText(raw, res.url || url);
  else if (/json/i.test(type)) { try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch {} }
  else if (!/text|xml|javascript|csv|markdown/i.test(type) && raw.includes('\u0000')) text = `[conteúdo binário: ${type}, ${size} bytes]`;
  return `HTTP ${res.status} ${res.statusText} · ${type.split(';')[0]} · ${res.url || url}\n\n${text}`;
}

/* ---------- web_search ---------- */
async function webSearch(query, cfg = {}, signal) {
  const provider = cfg.provider || 'duckduckgo';
  const timeout = AbortSignal.timeout(20000);
  const sig = AbortSignal.any ? AbortSignal.any([signal, timeout].filter(Boolean)) : timeout;
  let results = [];
  if (provider === 'brave') {
    if (!cfg.apiKey) throw new Error('Configure a chave da Brave Search em Configurações → Geral.');
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, { signal: sig, headers: { accept: 'application/json', 'X-Subscription-Token': cfg.apiKey } });
    if (!r.ok) throw new Error(`Brave Search ${r.status}`);
    const j = await r.json();
    results = (j.web?.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.description }));
  } else if (provider === 'tavily') {
    if (!cfg.apiKey) throw new Error('Configure a chave da Tavily em Configurações → Geral.');
    const r = await fetch('https://api.tavily.com/search', { method: 'POST', signal: sig, headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify({ query, max_results: 8 }) });
    if (!r.ok) throw new Error(`Tavily ${r.status}`);
    const j = await r.json();
    results = (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content }));
  } else {
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { signal: sig, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'text/html' } });
    const html = await r.text();
    const blocks = html.split(/class="result\s/).slice(1);
    for (const b of blocks) {
      const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!a) continue;
      let url = decode(a[1]);
      const ud = url.match(/[?&]uddg=([^&]+)/);
      if (ud) url = decodeURIComponent(ud[1]);
      if (url.startsWith('//')) url = `https:${url}`;
      if (/duckduckgo\.com\/y\.js/.test(url)) continue; // anúncio
      const sn = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      results.push({ title: decode(a[2].replace(/<[^>]+>/g, '')).trim(), url, snippet: sn ? decode(sn[1].replace(/<[^>]+>/g, '')).trim() : '' });
      if (results.length >= 8) break;
    }
    if (!results.length && /anomaly|captcha/i.test(html)) throw new Error('O DuckDuckGo bloqueou a busca automática. Configure Brave ou Tavily em Configurações → Geral.');
  }
  if (!results.length) return 'Nenhum resultado.';
  return results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}${x.snippet ? `\n   ${x.snippet}` : ''}`).join('\n\n');
}

module.exports = { glob, globToRegex, htmlToText, webFetch, webSearch };
