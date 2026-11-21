## Downloads

| Sistema | Arquivo |
|---|---|
| Mac com chip Apple (M1–M4) | **LastGravity-mac-apple-silicon.zip** |
| Mac Intel | **LastGravity-mac-intel.zip** |
| Windows 10/11 64 bits | **LastGravity-windows-x64.zip** |
| Linux 64 bits | **LastGravity-linux-x64.tar.gz** |

## Aviso de "baixado da internet"

O app ainda não tem assinatura paga da Apple/Microsoft, então o sistema avisa na primeira vez.

- **Mac:** mova o app para Aplicativos e rode no Terminal `xattr -cr /Applications/LastGravity.app`
- **Windows:** botão direito no .zip → Propriedades → marque **Desbloquear** → OK, depois extraia. Se aparecer o SmartScreen: **Mais informações → Executar assim mesmo**.
- **Linux:** `tar -xzf LastGravity-linux-x64.tar.gz && ./LastGravity-linux-x64/lastgravity` (se der erro de sandbox, use `--no-sandbox`).

Passo a passo completo: [docs/INSTALAR.md](https://github.com/pblfrnc/lastgravity/blob/main/docs/INSTALAR.md)

## Novidades

Veja o [CHANGELOG](https://github.com/pblfrnc/lastgravity/blob/main/CHANGELOG.md).
