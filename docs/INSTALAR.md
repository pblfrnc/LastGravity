# Instalar o LastGravity

Baixe o arquivo do seu sistema na página de [Releases](https://github.com/pblfrnc/lastgravity/releases/latest):

| Sistema | Arquivo |
|---|---|
| Mac com chip Apple (M1, M2, M3, M4…) | `LastGravity-mac-apple-silicon.zip` |
| Mac com processador Intel | `LastGravity-mac-intel.zip` |
| Windows 10/11 (64 bits) | `LastGravity-windows-x64.zip` |
| Linux (64 bits) | `LastGravity-linux-x64.tar.gz` |

> Não sabe qual é o seu Mac? Menu  → **Sobre Este Mac**. Se aparecer "Chip Apple M…", use Apple Silicon; se aparecer "Processador Intel…", use Intel.

O LastGravity ainda não tem assinatura paga da Apple nem da Microsoft. Por isso o sistema mostra um aviso de "baixado da internet" na primeira vez. O app é o mesmo código que está neste repositório; os passos abaixo só dizem ao sistema que você confia nele.

---

## macOS

1. Abra o `.zip` baixado (dois cliques). Vai aparecer o **LastGravity.app**.
2. Arraste o **LastGravity.app** para a pasta **Aplicativos**.
3. Abra o **Terminal** (⌘ Espaço → digite "Terminal") e cole:

   ```bash
   xattr -cr /Applications/LastGravity.app
   ```

4. Abra o LastGravity normalmente.

### Mensagens que esse comando resolve

- *"O LastGravity está danificado e não pode ser aberto. Você deve movê-lo para o Lixo."*
- *"Não é possível abrir o LastGravity porque o desenvolvedor não pode ser verificado."*
- *"A Apple não pôde verificar se o LastGravity está livre de malware."*

O `xattr -cr` remove a marca de quarentena que o navegador coloca em tudo o que é baixado.

### Sem Terminal

1. Tente abrir o app uma vez e feche o aviso.
2. Vá em **Ajustes do Sistema → Privacidade e Segurança**.
3. Role até o fim: aparece *"O LastGravity foi bloqueado…"*. Clique em **Abrir Mesmo Assim** e confirme com sua senha.

> No macOS 15 (Sequoia) ou mais novo, o clique com botão direito → "Abrir" não funciona mais para isso; use o Terminal ou os Ajustes acima.

---

## Windows

1. Clique com o botão direito no `LastGravity-windows-x64.zip` → **Propriedades**.
2. Embaixo, marque **Desbloquear** e clique em **OK**. (Isso evita o aviso em cada arquivo extraído.)
3. Clique com o botão direito → **Extrair Tudo…** e escolha uma pasta (por exemplo `C:\Programas\LastGravity`).
4. Abra **LastGravity.exe**.

### Se aparecer "O Windows protegeu o computador" (SmartScreen)

Clique em **Mais informações** → **Executar assim mesmo**. Só aparece na primeira vez.

### Pelo PowerShell (opcional)

```powershell
Get-ChildItem -Recurse "C:\Programas\LastGravity" | Unblock-File
```

Dica: clique com o botão direito no `LastGravity.exe` → **Mostrar mais opções** → **Fixar no Iniciar** ou **Criar atalho**.

---

## Linux

```bash
tar -xzf LastGravity-linux-x64.tar.gz
cd LastGravity-linux-x64
./lastgravity
```

Se der *"Permissão negada"*: `chmod +x lastgravity`.

Se der erro de *sandbox* (`chrome-sandbox` / `SUID sandbox helper`), escolha uma opção:

```bash
# opção 1 (recomendada): dar a permissão que o sandbox precisa
sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox

# opção 2: rodar sem o sandbox do Chromium
./lastgravity --no-sandbox
```

Para aparecer no menu de aplicativos:

```bash
mkdir -p ~/.local/share/applications ~/.local/share/icons
cp lastgravity.png ~/.local/share/icons/
sed "s#^Exec=.*#Exec=$PWD/lastgravity %U#" lastgravity.desktop > ~/.local/share/applications/lastgravity.desktop
```

---

## Requisitos

- Para usar modelos na nuvem: a chave de API do provedor (⚙ → Chaves de API).
- Para usar sem internet: [Ollama](https://ollama.com) instalado.
- O app já inclui tudo o que precisa para rodar; Node.js só é necessário para a CLI (`lastgravity run …`) e para compilar.
