# Boomm Printer Desktop

App local Windows que integra com o SaaS [Boomm Printer](https://github.com/agenciaboomm/boomm-printer) para impressão automática de etiquetas PDF e ZPL.

## O que faz

- Instala no computador do cliente como app Windows
- Pareia com a plataforma SaaS via chave de API
- Detecta impressoras locais instaladas no Windows
- Sincroniza a lista de impressoras com a nuvem
- Recebe jobs de impressão via polling (PDF ou ZPL)
- Imprime PDF usando o visualizador padrão do Windows
- Imprime ZPL RAW via socket TCP (porta 9100) ou porta LPT
- Atualiza o status de cada job no SaaS

## Arquitetura

```
SaaS Boomm Printer (Base44)
        │
        │ REST API (polling)
        │
 Boomm Printer Desktop (Electron / Windows)
        │
        ├─ Impressora PDF (Adobe Reader / Foxit / Edge)
        └─ Impressora ZPL (TCP 9100 / RAW LPT)
```

## Requisitos

- Windows 10 ou superior (64-bit)
- Node.js 18+ (apenas para desenvolvimento)
- Algum visualizador de PDF instalado para impressão de PDFs

## Desenvolvimento

```bash
git clone https://github.com/agenciaboomm/boomm-printer-desktop.git
cd boomm-printer-desktop
npm install
cp .env.example .env
# Editar .env com URL e chave da API
npm run dev
```

## Build

Veja [BUILD.md](./BUILD.md) para instruções detalhadas.

## Publicar Release

Veja [PUBLISHING.md](./PUBLISHING.md) para o fluxo completo.

## Testes

Veja [TESTING.md](./TESTING.md) para o guia de testes.

## Licença

MIT © Agência Boomm
