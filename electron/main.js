// LastGravity Desktop — processo principal do Electron.
// Cada pasta de projeto abre numa janela própria, com seu servidor local em porta aleatória.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, Notification, session, utilityProcess, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { fixPath } = require('./shellenv');

fixPath();
const config = require('../src/config');
const { sse } = require('../src/providers/util');

app.setName('LastGravity');
const isMac = process.platform === 'darwin';
const RECENT_FILE = path.join(config.DIR, 'recent.json');
const projects = new Map(); // root -> { win, child, url, statuses, closed }
let welcome = null;
let pendingOpen = null;

/* ---------- Projetos recentes ---------- */
function getRecent() {
  try { return JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8')).filter((p) => typeof p === 'string'); } catch { return []; }
}
function saveRecent(list) {
  fs.mkdirSync(config.DIR, { recursive: true });
  fs.writeFileSync(RECENT_FILE, JSON.stringify(list.slice(0, 12)));
  buildMenu();
}
function addRecent(p) {
  saveRecent([p, ...getRecent().filter((x) => x !== p)]);
  if (isMac) app.addRecentDocument(p);
}

/* ---------- Janelas ---------- */
// Tema salvo (Configurações → Aparência): escuro, claro ou o do sistema.
function themeMode() { try { return config.load().appearance?.theme || 'dark'; } catch { return 'dark'; } }
function themeResolved() { const m = themeMode(); nativeTheme.themeSource = m === 'system' ? 'system' : m; return m === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : m; }

function windowOptions(extra = {}) {
  return {
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    backgroundColor: themeResolved() === 'light' ? '#ffffff' : '#0f1117',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 13 },
    ...(process.platform === 'linux' ? { icon: path.join(__dirname, '..', 'build', 'icon.png') } : {}),
    autoHideMenuBar: !isMac,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    ...extra,
  };
}

const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
function guardNavigation(win, allowedUrl) {
  const getAllowed = typeof allowedUrl === 'function' ? allowedUrl : () => allowedUrl;
  const allowedNow = () => (getAllowed() ? originOf(getAllowed()) : null);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = allowedNow();
    if (allowed && originOf(url) === allowed) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
}

function showWelcome() {
  if (welcome) { welcome.show(); welcome.focus(); return; }
  welcome = new BrowserWindow(windowOptions({ width: 860, height: 580, minWidth: 700, minHeight: 480, resizable: true }));
  guardNavigation(welcome, null);
  welcome.loadFile(path.join(__dirname, 'welcome.html'), { query: { theme: themeMode() } });
  welcome.once('ready-to-show', () => welcome.show());
  welcome.on('closed', () => { welcome = null; });
}

// Abre um projeto: a janela aparece na hora ("Abrindo…") e o servidor roda num processo separado,
// então pastas enormes ou pedidos de permissão do macOS nunca congelam o app.
async function openProject(root, { trust = false } = {}) {
  root = path.resolve(root);
  const existing = projects.get(root);
  if (existing) { existing.win.show(); existing.win.focus(); return; }

  const name = path.basename(root);
  const win = new BrowserWindow(windowOptions({ title: `${name} — LastGravity` }));
  const entry = { win, child: null, url: null, statuses: new Map(), closed: false };
  projects.set(root, entry);
  guardNavigation(win, () => entry.url);
  win.loadFile(path.join(__dirname, 'loading.html'), { query: { name, path: root, theme: themeMode() } });
  win.once('ready-to-show', () => { win.show(); if (welcome) welcome.close(); });
  win.on('closed', () => {
    entry.closed = true;
    try { entry.child?.postMessage({ type: 'stop' }); } catch {}
    setTimeout(() => { try { entry.child?.kill(); } catch {} }, 1500);
    projects.delete(root);
    updateBadge();
    if (!projects.size && !isMac) showWelcome();
  });

  try {
    entry.child = utilityProcess.fork(path.join(__dirname, 'server-child.js'), [root, ...(trust ? ['--trust'] : [])], { env: process.env, stdio: 'pipe', serviceName: `LastGravity · ${name}` });
    entry.child.stdout?.on('data', (d) => process.stdout.write(d));
    entry.child.stderr?.on('data', (d) => process.stderr.write(d));
    entry.url = await new Promise((resolve, reject) => {
      entry.child.on('message', (m) => { if (m?.type === 'ready') resolve(m.url); else if (m?.type === 'error') reject(new Error(m.message)); });
      entry.child.once('exit', (code) => reject(new Error(`O processo do projeto encerrou inesperadamente (código ${code}).`)));
    });
  } catch (e) {
    if (!entry.closed) {
      dialog.showErrorBox('Não foi possível abrir o projeto', `${root}\n\n${e.message}`);
      win.close();
    }
    if (/não encontrada|ENOENT/i.test(e.message)) saveRecent(getRecent().filter((x) => x !== root));
    return;
  }
  if (entry.closed) return;
  entry.child.on('exit', (code) => {
    if (entry.closed || win.isDestroyed()) return;
    const r = dialog.showMessageBoxSync(win, { type: 'error', message: 'O processo deste projeto parou.', detail: `Código ${code}. Os agentes salvos continuam no histórico.`, buttons: ['Reabrir', 'Fechar janela'] });
    win.close();
    if (r === 0) setTimeout(() => openProject(root), 300);
  });
  win.loadURL(`${entry.url}/?desktop=${process.platform}&theme=${themeMode()}`);
  if (isMac) win.setRepresentedFilename(root);
  addRecent(root);
  watchEvents(entry, root);
}

// Notificações nativas + selo no Dock: o app acompanha os eventos do servidor do projeto.
async function watchEvents(entry, root) {
  while (!entry.closed) {
    try {
      const res = await fetch(`${entry.url}/api/events`);
      for await (const ev of sse(res, { idleMs: 90000 })) {
        if (entry.closed) break;
        if (ev.event === 'agent') onAgent(entry, root, JSON.parse(ev.data));
        else if (ev.event === 'friends') onFriends(entry, root, JSON.parse(ev.data));
      }
    } catch {}
    if (!entry.closed) await new Promise((r) => setTimeout(r, 2000));
  }
}

function onAgent(entry, root, a) {
  const { win } = entry;
  const prev = entry.statuses.get(a.id);
  entry.statuses.set(a.id, a.status);
  updateBadge();
  if (prev === a.status || win.isDestroyed() || win.isFocused()) return;
  const msgs = { awaiting_approval: 'precisa da sua aprovação', done: 'concluiu a tarefa', error: 'encontrou um erro' };
  if (!msgs[a.status] || !Notification.isSupported() || config.load().notifications === false) return;
  const n = new Notification({ title: `${path.basename(root)} · LastGravity`, body: `“${a.title}” ${msgs[a.status]}` });
  n.on('click', () => {
    win.show(); win.focus();
    win.webContents.executeJavaScript(`document.querySelector('[data-view=manager]').click(); selectAgent(${JSON.stringify(a.id)});`).catch(() => {});
  });
  n.show();
}

// MyFriends: mensagem de outra IDE (Claude Code, Codex…) vira notificação nativa quando a janela não está em foco.
function onFriends(entry, root, d) {
  const { win } = entry;
  const list = (d?.incoming || []).filter((m) => m.forUser || m.type === 'task' || m.type === 'handoff');
  if (!list.length || win.isDestroyed() || win.isFocused()) return;
  if (!Notification.isSupported() || config.load().notifications === false) return;
  const m = list[list.length - 1];
  const kind = m.type === 'task' ? 'pediu uma tarefa' : m.type === 'handoff' ? 'passou um trabalho (handoff)' : m.to ? 'mandou uma mensagem para você' : 'escreveu na sala';
  const n = new Notification({ title: `${m.fromName} ${kind}`, subtitle: `MyFriends · ${path.basename(root)}`, body: `${m.text}${list.length > 1 ? ` (+${list.length - 1})` : ''}` });
  n.on('click', () => {
    win.show(); win.focus();
    win.webContents.executeJavaScript(`window.LGFriends && window.LGFriends.open()`).catch(() => {});
  });
  n.show();
}

function updateBadge() {
  let waiting = 0;
  for (const { statuses } of projects.values()) for (const s of statuses.values()) if (s === 'awaiting_approval') waiting++;
  if (isMac) app.dock?.setBadge(waiting ? String(waiting) : '');
  else app.setBadgeCount?.(waiting);
}

async function pickFolder(title, create) {
  const res = await dialog.showOpenDialog({
    title, buttonLabel: create ? 'Criar projeto aqui' : 'Abrir',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!res.canceled && res.filePaths[0]) await openProject(res.filePaths[0], { trust: !!create });
  return !res.canceled;
}

/* ---------- Menu ---------- */
function runInFocused(js) {
  const w = BrowserWindow.getFocusedWindow();
  if (w && w !== welcome) w.webContents.executeJavaScript(js).catch(() => {});
}

function buildMenu() {
  const recent = getRecent();
  const template = [
    ...(isMac ? [{
      label: 'LastGravity',
      submenu: [
        { role: 'about', label: 'Sobre o LastGravity' },
        { type: 'separator' },
        { label: 'Configurações…', accelerator: 'Cmd+,', click: () => runInFocused("document.getElementById('btn-settings').click()") },
        { type: 'separator' },
        { role: 'services', label: 'Serviços' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar LastGravity' }, { role: 'hideOthers', label: 'Ocultar outros' }, { role: 'unhide', label: 'Mostrar tudo' },
        { type: 'separator' },
        { role: 'quit', label: 'Encerrar LastGravity' },
      ],
    }] : []),
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Tela inicial', accelerator: 'CmdOrCtrl+Shift+N', click: showWelcome },
        { label: 'Abrir pasta…', accelerator: 'CmdOrCtrl+O', click: () => pickFolder('Abrir projeto') },
        {
          label: 'Abrir recente',
          submenu: recent.length
            ? [...recent.map((p) => ({ label: p, click: () => openProject(p) })), { type: 'separator' }, { label: 'Limpar recentes', click: () => { saveRecent([]); if (isMac) app.clearRecentDocuments(); } }]
            : [{ label: 'Nenhum projeto recente', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Mostrar pasta no Finder', click: () => { const w = BrowserWindow.getFocusedWindow(); for (const [root, e] of projects) if (e.win === w) shell.openPath(root); } },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Fechar janela' } : { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' },
        { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Agente',
      submenu: [
        { label: 'Novo agente…', accelerator: 'CmdOrCtrl+N', click: () => runInFocused("document.getElementById('btn-new').click()") },
        { type: 'separator' },
        { label: 'Visão Editor', accelerator: 'CmdOrCtrl+1', click: () => runInFocused("document.querySelector('[data-view=editor]').click()") },
        { label: 'Visão Gerenciador', accelerator: 'CmdOrCtrl+2', click: () => runInFocused("document.querySelector('[data-view=manager]').click()") },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recarregar' }, { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' }, { type: 'separator' },
        { role: 'resetZoom', label: 'Tamanho real' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
    { role: 'windowMenu', label: 'Janela' },
    {
      role: 'help', label: 'Ajuda',
      submenu: [
        { label: 'Abrir pasta de configurações', click: () => { fs.mkdirSync(config.DIR, { recursive: true }); shell.openPath(config.DIR); } },
        { label: 'Baixar Ollama (modelos locais grátis)', click: () => shell.openExternal('https://ollama.com') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- IPC (tela inicial) ---------- */
ipcMain.handle('lg:recent', () => getRecent().map((p) => ({ path: p, name: path.basename(p) })));
ipcMain.handle('lg:open-folder', () => pickFolder('Abrir projeto'));
ipcMain.handle('lg:new-project', () => pickFolder('Escolha ou crie a pasta do novo projeto', true));
ipcMain.handle('lg:open', (e, p) => openProject(p));
ipcMain.handle('lg:remove-recent', (e, p) => saveRecent(getRecent().filter((x) => x !== p)));
ipcMain.handle('lg:version', () => app.getVersion());

/* ---------- Ciclo de vida ---------- */
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (e, argv) => {
  const dir = argv.slice(1).find((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isDirectory());
  if (dir) openProject(dir); else showWelcome();
});
app.on('open-file', (e, p) => { e.preventDefault(); if (app.isReady()) openProject(p); else pendingOpen = p; });

app.whenReady().then(() => {
  // Nada de câmera, microfone, localização etc.; nada de conteúdo remoto além das APIs que o servidor chama.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write' || perm === 'notifications'));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'clipboard-sanitized-write' || perm === 'notifications');
  app.setAboutPanelOptions({ applicationName: 'LastGravity', applicationVersion: app.getVersion(), copyright: 'Licença MIT', credits: 'IDE agent-first, aberta e multi-modelo.' });
  buildMenu();
  const argDir = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isDirectory());
  const target = pendingOpen || argDir;
  if (target) openProject(target); else showWelcome();
});
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) showWelcome(); });
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
