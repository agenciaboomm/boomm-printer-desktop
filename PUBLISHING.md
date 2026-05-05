# Guia de Publicação — Boomm Printer Desktop

## Publicar Release v0.1.0

### Passo 1: Rodar o GitHub Actions

1. https://github.com/agenciaboomm/boomm-printer-desktop/actions
2. **Build Windows Installer** → **Run workflow**
3. Version: `0.1.0` → **Run workflow**
4. Aguarde ~5–8 minutos

### Passo 2: Verificar a Release

https://github.com/agenciaboomm/boomm-printer-desktop/releases

Devem estar presentes:
- `BoommPrinterSetup-0.1.0.exe`
- `SHA256SUMS.txt`

Link direto:
```
https://github.com/agenciaboomm/boomm-printer-desktop/releases/download/v0.1.0/BoommPrinterSetup-0.1.0.exe
```

### Passo 3: Configurar no SaaS Boomm Printer (Base44)

| Campo | Valor |
|-------|-------|
| Plataforma | Windows |
| Versão | 0.1.0 |
| URL de Download | `https://github.com/agenciaboomm/boomm-printer-desktop/releases/download/v0.1.0/BoommPrinterSetup-0.1.0.exe` |
| Nome do arquivo | `BoommPrinterSetup-0.1.0.exe` |
| Status | Ativo |

## Nova versão (ex: v0.2.0)

```bash
npm version 0.2.0 --no-git-tag-version
git add package.json
git commit -m "chore: bump version to 0.2.0"
git tag v0.2.0
git push origin main --tags
```

## Checklist

- [ ] Workflow Actions concluído (verde)
- [ ] .exe na Release
- [ ] SHA256 gerado
- [ ] Link direto funcionando
- [ ] SaaS Base44 atualizado
- [ ] Instalador testado em Windows real
