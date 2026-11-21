// Extensão LastGravity para VS Code: inicia o servidor do LastGravity na pasta aberta e mostra a
// central de controle (Editor + Gerenciador de agentes) num painel; cria tarefas a partir do editor.
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let server = null; // { proc, url, root }
let panel = null;
let status = null;
let output = null;

function serverEntry(ctx) {
  const custom = vscode.workspace.getConfiguration('lastgravity').get('serverPath');
  const base = custom || path.join(ctx.extensionPath, 'server');
  const entry = path.join(base, 'bin', 'lastgravity.js');
  if (!fs.existsSync(entry)) throw new Error(`Servidor do LastGravity não encontrado em ${base}. Ajuste "lastgravity.serverPath".`);
  return entry;
}

function workspaceRoot() {
  const ed = vscode.window.activeTextEditor;
  const f = ed && vscode.workspace.getWorkspaceFolder(ed.document.uri);
  const folder = f || vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Abra uma pasta no VS Code primeiro.');
  return folder.uri.fsPath;
}

function start(ctx) {
  const root = workspaceRoot();
  if (server && server.root === root && server.url) return Promise.resolve(server);
  stop();
  return new Promise((resolve, reject) => {
    const nodePath = vscode.workspace.getConfiguration('lastgravity').get('nodePath');
    const cmd = nodePath || process.execPath;
    const env = { ...process.env, ...(nodePath ? {} : { ELECTRON_RUN_AS_NODE: '1' }) };
    const proc = spawn(cmd, [serverEntry(ctx), root, '--port', '0'], { cwd: root, env });
    server = { proc, root, url: null };
    let buf = '';
    const timer = setTimeout(() => reject(new Error('O servidor do LastGravity não iniciou em 20 s. Veja a saída "LastGravity".')), 20000);
    const onData = (d) => {
      const s = d.toString();
      output.append(s);
      buf += s;
      const m = buf.match(/http:\/\/localhost:\d+/);
      if (m && !server.url) { server.url = m[0]; clearTimeout(timer); setStatus(); resolve(server); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => output.append(d.toString()));
    proc.on('exit', (code) => { output.appendLine(`[servidor encerrado: ${code}]`); if (server?.proc === proc) server = null; setStatus(); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function stop() {
  if (server?.proc) { try { server.proc.kill(); } catch {} }
  server = null;
  setStatus();
}

function setStatus(waiting = 0) {
  if (!status) return;
  status.text = server?.url ? `$(rocket) LastGravity${waiting ? ` $(bell) ${waiting}` : ''}` : '$(rocket) LastGravity';
  status.tooltip = server?.url ? `Servidor em ${server.url} — clique para abrir` : 'Abrir o LastGravity';
}

async function api(p, body) {
  const res = await fetch(server.url + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-lastgravity': '1' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

async function openPanel(ctx, select) {
  await start(ctx);
  const ext = await vscode.env.asExternalUri(vscode.Uri.parse(server.url));
  const src = `${ext.toString(true).replace(/\/$/, '')}/?embed=vscode${select ? `#agent=${encodeURIComponent(select)}` : ''}`;
  if (!panel) {
    panel = vscode.window.createWebviewPanel('lastgravity', 'LastGravity', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    panel.iconPath = vscode.Uri.file(path.join(ctx.extensionPath, 'media', 'icon.png'));
    panel.onDidDispose(() => { panel = null; });
  }
  const origin = new URL(ext.toString(true)).origin;
  panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline';">
<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100vh;background:#0f1117;overflow:hidden}</style></head>
<body><iframe src="${src}" allow="clipboard-read; clipboard-write"></iframe></body></html>`;
  panel.reveal(vscode.ViewColumn.Beside);
}

async function newAgent(ctx, prefill = '') {
  const prompt = await vscode.window.showInputBox({ title: 'LastGravity — nova tarefa', prompt: 'O que o agente deve fazer?', value: prefill, ignoreFocusOut: true });
  if (!prompt) return;
  await start(ctx);
  const approval = vscode.workspace.getConfiguration('lastgravity').get('defaultApproval');
  const a = await api('/api/agents', { prompt, approval });
  await openPanel(ctx, a.id);
  vscode.window.setStatusBarMessage(`LastGravity: agente iniciado — ${a.title}`, 4000);
}

function activate(ctx) {
  output = vscode.window.createOutputChannel('LastGravity');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'lastgravity.open';
  setStatus();
  status.show();
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { vscode.window.showErrorMessage(`LastGravity: ${e.message}`); } };
  ctx.subscriptions.push(
    output, status,
    vscode.commands.registerCommand('lastgravity.open', wrap(() => openPanel(ctx))),
    vscode.commands.registerCommand('lastgravity.newAgent', wrap(() => newAgent(ctx))),
    vscode.commands.registerCommand('lastgravity.askAboutSelection', wrap(() => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const rel = vscode.workspace.asRelativePath(ed.document.uri);
      const sel = ed.document.getText(ed.selection);
      const lines = `${ed.selection.start.line + 1}-${ed.selection.end.line + 1}`;
      return newAgent(ctx, `Em ${rel} (linhas ${lines}):\n\n${sel.slice(0, 4000)}\n\n`);
    })),
    vscode.commands.registerCommand('lastgravity.openInBrowser', wrap(async () => { await start(ctx); vscode.env.openExternal(vscode.Uri.parse(server.url)); })),
    vscode.commands.registerCommand('lastgravity.restart', wrap(async () => { stop(); await start(ctx); if (panel) await openPanel(ctx); })),
    { dispose: stop },
  );
  // Aviso discreto quando um agente precisa de aprovação.
  const poll = setInterval(async () => {
    if (!server?.url) return;
    try {
      const list = await api('/api/agents');
      const waiting = list.filter((a) => a.status === 'awaiting_approval').length;
      setStatus(waiting);
      if (waiting && !panel?.visible && !poll.warned) {
        poll.warned = true;
        const pick = await vscode.window.showInformationMessage(`LastGravity: ${waiting} agente(s) aguardando sua aprovação.`, 'Abrir');
        if (pick) openPanel(ctx);
      }
      if (!waiting) poll.warned = false;
    } catch {}
  }, 4000);
  ctx.subscriptions.push({ dispose: () => clearInterval(poll) });
}

function deactivate() { stop(); }

module.exports = { activate, deactivate };
