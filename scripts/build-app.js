// Gera o app desktop do LastGravity para macOS, Windows ou Linux.
// Uso: node scripts/build-app.js <mac|win|linux> [x64|arm64]
//   npm run build:mac   ·   npm run build:win   ·   npm run build:linux
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const root = path.join(__dirname, '..');
const alias = { mac: 'darwin', macos: 'darwin', darwin: 'darwin', win: 'win32', windows: 'win32', win32: 'win32', linux: 'linux' };
const host = { darwin: 'darwin', win32: 'win32' }[process.platform] || 'linux';
const platform = alias[(process.argv[2] || host).toLowerCase()];
if (!platform) { console.error('Plataforma inválida. Use: mac, win ou linux.'); process.exit(1); }
const arch = process.argv[3] || (process.platform === platform ? process.arch : 'x64');
const pkg = require(path.join(root, 'package.json'));

const icons = { darwin: 'icon.icns', win32: 'icon.ico', linux: 'icon.png' };
// No Windows, gravar ícone e metadados no .exe fora do Windows exige o Wine; sem ele, segue sem.
const canEditExe = platform !== 'win32' || process.platform === 'win32' || (() => { try { execSync('wine --version', { stdio: 'ignore' }); return true; } catch { return false; } })();

(async () => {
  const { packager } = await import('@electron/packager');
  execSync('node scripts/copy-vendor.js', { cwd: root, stdio: 'inherit' });
  const opts = {
    dir: root,
    out: path.join(root, 'dist'),
    overwrite: true,
    platform,
    arch,
    name: 'LastGravity',
    executableName: platform === 'linux' ? 'lastgravity' : 'LastGravity',
    appVersion: pkg.version,
    appCopyright: 'Licença MIT',
    asar: true,
    prune: true,
    ignore: [/^\/dist($|\/)/, /^\/vscode-extension($|\/)/, /^\/test($|\/)/, /^\/scripts($|\/)/, /^\/\.github($|\/)/, /^\/build\/icon\.(svg|icns|ico)$/, /^\/\.lastgravity($|\/)/, /^\/node_modules($|\/)/, /\.zip$/],
    ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
  };
  if (canEditExe) opts.icon = path.join(root, 'build', icons[platform]);
  if (platform === 'darwin') Object.assign(opts, {
    appBundleId: 'app.lastgravity.ide',
    appCategoryType: 'public.app-category.developer-tools',
    darwinDarkModeSupport: true,
    extendInfo: {
      LSApplicationCategoryType: 'public.app-category.developer-tools',
      NSDocumentsFolderUsageDescription: 'O LastGravity precisa acessar a pasta do projeto que você abriu para ler e editar os arquivos.',
      NSDesktopFolderUsageDescription: 'O LastGravity precisa acessar a pasta do projeto que você abriu para ler e editar os arquivos.',
      NSDownloadsFolderUsageDescription: 'O LastGravity precisa acessar a pasta do projeto que você abriu para ler e editar os arquivos.',
      NSRemovableVolumesUsageDescription: 'O LastGravity precisa acessar a pasta do projeto que você abriu.',
      NSNetworkVolumesUsageDescription: 'O LastGravity precisa acessar a pasta do projeto que você abriu.',
    },
  });
  if (platform === 'win32' && canEditExe) opts.win32metadata = { CompanyName: 'LastGravity', ProductName: 'LastGravity', FileDescription: 'LastGravity — IDE agent-first', OriginalFilename: 'LastGravity.exe' };

  const [out] = await packager(opts);
  if (platform === 'darwin' && process.platform === 'darwin') {
    // Assinatura ad-hoc: suficiente para rodar no próprio Mac (não substitui a notarização da Apple).
    execSync(`codesign --force --deep --sign - "${path.join(out, 'LastGravity.app')}"`, { stdio: 'inherit' });
  }
  if (platform === 'linux') {
    fs.writeFileSync(path.join(out, 'lastgravity.desktop'), `[Desktop Entry]
Name=LastGravity
Comment=IDE agent-first, aberta e multi-modelo
Exec=lastgravity %U
Icon=lastgravity
Terminal=false
Type=Application
Categories=Development;IDE;
`);
    fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(out, 'lastgravity.png'));
  }
  if (!canEditExe) console.log('\n(aviso) Wine não encontrado: o .exe saiu sem ícone. Gere no Windows para ter o ícone.');
  console.log(`\n✅ App gerado: ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
