# Guia de Publicação — Boomm Printer Desktop

## Fluxo completo para publicar a Release v0.1.0

### Passo 1: Rodar o GitHub Actions

1. Acesse o repositório:
   https://github.com/agenciaboomm/boomm-printer-desktop

2. Clique em **Actions**

3. Selecione o workflow **Build Windows Installer**

4. Clique em **Run workflow** (lado direito)

5. Preencha:
   - Branch: `main` (ou a branch atual)
   - Version: `0.1.0`

6. Clique em **Run workflow**

7. Aguarde ~5 a 8 minutos

### Passo 2: Verificar a Release

Após o workflow concluir com sucesso:

1. Vá em **Releases**:
   https://github.com/agenciaboomm/boomm-printer-desktop/releases

2. Verifique se a Release `v0.1.0` foi criada com:
   - `BoommPrinterSetup-0.1.0.exe`
   - `SHA256SUMS.txt`

3. Copie o link direto do `.exe`:
   ```
   https://github.com/agenciaboomm/boomm-printer-desktop/releases/download/v0.1.0/BoommPrinterSetup-0.1.0.exe
   ```

### Passo 3: Configurar no SaaS Boomm Printer (Base44)

Acesse a área administrativa do SaaS Boomm Printer e preencha:

| Campo | Valor |
|-------|-------|
| Plataforma | Windows |
| Versão | 0.1.0 |
| URL de Download | `https://github.com/agenciaboomm/boomm-printer-desktop/releases/download/v0.1.0/BoommPrinterSetup-0.1.0.exe` |
| Nome do arquivo | `BoommPrinterSetup-0.1.0.exe` |
| Status | Ativo |

### Publicar nova versão

Para publicar uma nova versão (ex: `v0.2.0`):

**Opção A — via tag:**
```bash
# Atualize a versão no package.json
npm version 0.2.0 --no-git-tag-version
git add package.json
git commit -m "chore: bump version to 0.2.0"
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

**Opção B — via workflow_dispatch:**
1. Actions → Build Windows Installer → Run workflow
2. Informe a nova versão

### Checklist de publicação

- [ ] Workflow Actions concluído com sucesso (verde)
- [ ] Arquivo `BoommPrinterSetup-0.1.0.exe` na Release
- [ ] Checksum SHA256 gerado e publicado
- [ ] Link direto do `.exe` funcionando
- [ ] SaaS Base44 atualizado com URL e versão
- [ ] Instalador testado em uma máquina real Windows
