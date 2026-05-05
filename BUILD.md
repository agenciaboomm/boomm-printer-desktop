# Guia de Build — Boomm Printer Desktop

## Via GitHub Actions (recomendado)

### Por tag

```bash
git tag v0.1.0
git push origin v0.1.0
```

### Via workflow_dispatch

1. Actions → **Build Windows Installer** → **Run workflow**
2. Informe a versão (padrão: `0.1.0`)
3. Clique **Run workflow** e aguarde ~5–8 min

## Build local (Windows)

```bash
npm install
npm run build
# Resultado: dist/BoommPrinterSetup-0.1.0.exe
```

## Sem instalador (apenas para testar)

```bash
npm run pack  # Gera dist/win-unpacked/
npm start     # Roda o app
```

## Configuração electron-builder

```json
"win": {
  "target": "nsis",
  "artifactName": "BoommPrinterSetup-${version}.exe"
}
```

O `artifactName` garante o nome exato `BoommPrinterSetup-0.1.0.exe`.
