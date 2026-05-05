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
# Clonar o repositório
git clone https://github.com/agenciaboomm/boomm-printer-desktop.git
cd boomm-printer-desktop

# Instalar dependências
npm install

# Copiar e preencher o .env
cp .env.example .env

# Rodar em modo desenvolvimento
npm run dev
```

## Gerar Build

Veja [BUILD.md](./BUILD.md) para instruções detalhadas de build local e via GitHub Actions.

## Publicar Release

Veja [PUBLISHING.md](./PUBLISHING.md) para o fluxo completo de publicação.

## Testes

Veja [TESTING.md](./TESTING.md) para guia de testes manuais.

## Estrutura do projeto

```
boomm-printer-desktop/
├── .github/
│   └── workflows/
│       └── build-windows.yml   # CI/CD build + release
├── build/                       # Recursos de build (ícones, etc.)
├── src/
│   ├── main.js                  # Processo principal Electron
│   ├── preload.js               # Bridge segura main ↔ renderer
│   ├── services/
│   │   ├── api.js               # Cliente HTTP para o SaaS
│   │   ├── printer.js           # Detecção e impressão
│   │   ├── job-processor.js     # Loop de polling de jobs
│   │   └── store.js             # Armazenamento local (electron-store)
│   └── renderer/
│       ├── index.html           # Interface do usuário
│       └── renderer.js          # Lógica da UI
├── .env.example
├── package.json
├── README.md
├── BUILD.md
├── TESTING.md
└── PUBLISHING.md
```

## Licença

MIT © Agência Boomm
