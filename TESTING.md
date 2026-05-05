# Guia de Testes — Boomm Printer Desktop

## Testes em desenvolvimento

### 1. Rodar o app localmente

```bash
npm install
cp .env.example .env
# Editar .env com a URL e chave da API
npm run dev
```

### 2. Testar detecção de impressoras

1. Abra o app
2. Vá em **Impressoras**
3. Clique em **↻ Atualizar**
4. Verifique se a lista mostra as impressoras instaladas no Windows
5. A impressora padrão deve estar destacada em laranja

### 3. Testar conexão com o SaaS

1. Vá em **Configurações**
2. Preencha **URL da API** e **Chave de API**
3. Clique em **Testar Conexão**
4. Verifique o badge no canto superior direito (verde = conectado)

### 4. Testar impressão de PDF

Para testar manualmente, adicione temporariamente ao `job-processor.js`:

```js
// Teste direto
const { printPDF } = require('./printer');
const fs = require('fs');
const pdfBuffer = fs.readFileSync('C:/caminho/para/etiqueta.pdf');
await printPDF('Nome da Impressora', pdfBuffer);
```

### 5. Testar impressão ZPL

Para impressoras ZPL via rede (IP):

```js
const { printZPL } = require('./printer');
await printZPL('192.168.1.100', '^XA^FO50,50^ADN,36,20^FDHello ZPL^FS^XZ');
```

## Testes do instalador

### 1. Testar instalação

1. Baixe `BoommPrinterSetup-0.1.0.exe` da Release
2. Execute como Administrador
3. Siga o assistente de instalação
4. Verifique se o atalho na área de trabalho foi criado
5. Abra o app pelo atalho

### 2. Testar desinstalação

1. Acesse Painel de Controle > Programas e Recursos
2. Localize "BoommPrinter"
3. Clique em Desinstalar
4. Verifique se o app foi removido corretamente

### 3. Requisitos do ambiente de teste

- Windows 10 ou 11 (64-bit)
- Pelo menos uma impressora instalada
- Algum visualizador de PDF (Adobe Reader, Foxit, Edge)
- Acesso à internet

## Checklist de validação

- [ ] App instala sem erros
- [ ] Atalho na área de trabalho funciona
- [ ] App abre e exibe a UI corretamente
- [ ] Lista de impressoras carrega
- [ ] Configurações salvam e persistem após reiniciar
- [ ] Conexão com o SaaS funciona
- [ ] Jobs pendentes são buscados e impressos
- [ ] Status dos jobs é atualizado no SaaS
- [ ] App desinstala sem erros
