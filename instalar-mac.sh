#!/bin/bash
# Compila o LastGravity no seu Mac, instala em /Applications e abre.
# Uso: bash instalar-mac.sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js não encontrado. Instale a versão 18 ou mais nova em https://nodejs.org e rode de novo."
  exit 1
fi
echo "▶ Node $(node -v) encontrado"

echo "▶ Instalando dependências (Electron, editor Monaco)…"
npm install --no-fund --no-audit

echo "▶ Compilando o app…"
node scripts/build-mac.js

ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH=x64
APP="dist/LastGravity-darwin-$ARCH/LastGravity.app"

echo "▶ Instalando em /Applications…"
rm -rf "/Applications/LastGravity.app"
cp -R "$APP" /Applications/
open "/Applications/LastGravity.app"
echo "✅ Pronto! O LastGravity está em Aplicativos."
