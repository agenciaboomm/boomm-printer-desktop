# Guia de Testes — Boomm Printer Desktop

## Desenvolvimento

```bash
npm install
cp .env.example .env
npm run dev
```

## Checklist de validação

- [ ] App abre e exibe a UI
- [ ] Lista de impressoras carrega (aba Impressoras)
- [ ] Configurações salvam e persistem após reiniciar
- [ ] Conexão com SaaS funciona (botão Testar Conexão)
- [ ] Jobs são buscados e impressos
- [ ] Status dos jobs é atualizado no SaaS

## Testar instalador

1. Baixe `BoommPrinterSetup-0.1.0.exe` da Release
2. Execute como Administrador
3. Verifique atalho na área de trabalho
4. Abra o app e configure as credenciais

## Requisitos de ambiente

- Windows 10/11 (64-bit)
- Uma impressora instalada
- Visualizador de PDF (Adobe Reader, Foxit, Edge)
- Acesso à internet
