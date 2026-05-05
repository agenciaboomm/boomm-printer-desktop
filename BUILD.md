# Guia de Build — Boomm Printer Desktop

## Build via GitHub Actions (recomendado)

O instalador Windows é gerado automaticamente pelo GitHub Actions em um runner `windows-latest`.

### Fluxo automático (tag)

1. Crie e faça push de uma tag `v*`:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

2. O workflow `build-windows.yml` será disparado automaticamente.
3. O instalador será publicado na Release `v0.1.0`.

### Execução manual (workflow_dispatch)

1. Vá em **Actions** → **Build Windows Installer**
2. Clique em **Run workflow**
3. Informe a versão (padrão: `0.1.0`)
4. Clique em **Run workflow**
5. Aguarde o workflow concluir (~5–8 min)
6. O arquivo `BoommPrinterSetup-0.1.0.exe` será publicado na Release `v0.1.0`

## Build local (Windows)

Requer Windows com Node.js 18+ instalado.

```bash
# Instalar dependências
npm install

# Gerar instalador .exe
npm run build

# O arquivo será gerado em:
# dist/BoommPrinterSetup-0.1.0.exe
```

## Build local (apenas para testar, sem instalador)

```bash
# Gera pasta descompactada do app (sem criar .exe)
npm run pack

# Rodar o app diretamente
npm start
```

## O que o electron-builder gera

| Arquivo | Descrição |
|---------|------------|
| `dist/BoommPrinterSetup-0.1.0.exe` | Instalador NSIS para Windows x64 |
| `dist/SHA256SUMS.txt` | Checksum SHA256 do instalador |
| `dist/win-unpacked/` | App descompactado (não distribuír) |

## Configuração do electron-builder

A configuração está em `package.json` na chave `"build"`:

```json
"build": {
  "appId": "com.agenciaboomm.boomm-printer-desktop",
  "productName": "BoommPrinter",
  "win": {
    "target": "nsis",
    "artifactName": "BoommPrinterSetup-${version}.exe"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
}
```

O `artifactName` garante que o arquivo sempre se chame `BoommPrinterSetup-{versão}.exe`.
