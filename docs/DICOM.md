# DICOM: leitura, extração e análise

Aivis recebe DICOM Part 10 (`.dicom` ou `.dcm`) como formato principal de exames de imagem. Usa [ITK-Wasm](https://github.com/InsightSoftwareConsortium/ITK-Wasm), com GDCM para decodificar pixels; [dicom-parser](https://github.com/cornerstonejs/dicomParser) para inspecionar o cabeçalho; e [Sharp](https://sharp.pixelplumbing.com/) para produzir PNGs. Os ícones da interface vêm de [Lucide](https://lucide.dev/), em SVG, sem emojis.

## Fluxo

1. Autorização do upload, reservando caminho privado, formato, tamanho e cota do caso.
2. Upload direto ao Supabase, sem atravessar o limite de corpo das funções da Vercel.
3. Confirmação no servidor: consulta de tamanho real, verificação de assinatura Part 10, metadados e limites antes de registrar o exame.
4. Prévia de um frame/janela por vez, via endpoint autenticado, ou download do original por URL assinada curta.
5. Na análise, download privado e extração de todos os frames/janelas suportados em PNG. Cada imagem é identificada pelo exame, frame e janela no prompt. O DICOM original não é enviado como imagem binária ao Grok.
6. O rascunho registra as limitações de resolução/janelamento e continua dependendo da revisão e aprovação do médico.

O modo de demonstração lista arquivos e simula o fluxo, sem processar dados clínicos ou gerar imagens falsas. Para testar extração sem Supabase/xAI, execute os testes com fixtures sintéticas; para a interface real, configure o Supabase e aplique a migração incremental.

## Formatos

Sintaxes aceitas pelo cabeçalho: Implicit VR Little Endian, Explicit VR Little Endian, Explicit VR Big Endian, RLE Lossless, JPEG Baseline/Extended, JPEG Lossless, JPEG-LS e JPEG 2000. A decodificação final é feita pelo GDCM; um codec ou arquivo que falhe gera erro explícito, preservando o caso. Os testes próprios cobrem nativos Little/Big Endian, RLE e JPEG Baseline; não equivalem a uma validação clínica de todas as variantes de compressão aceitas pelo GDCM.

Pixels inteiros de 8, 16 e 32 bits; monocromáticos MONOCHROME1/MONOCHROME2 e cores RGB/YBR/paleta quando o GDCM entrega os três canais esperados. São tratados valores assinados, rescale slope/intercept e janelas LINEAR/LINEAR_EXACT/SIGMOID. A inversão automática do GDCM é compensada antes de aplicar a apresentação final, evitando dupla inversão. Espaçamento físico informado é usado no dimensionamento da prévia.

Não suportados: datasets sem cabeçalho Part 10, DICOMDIR, SR, PDF encapsulado, vídeos MPEG, Deflated, pixels float/double, Presentation LUT e VOI/Modality LUT em tabelas. Essas entradas são recusadas; não há conversão silenciosa para uma imagem clínica presumida. A apresentação não desenha overlays. Dados queimados nos próprios pixels permanecem visíveis.

## Limites

| Recurso                      | Limite                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| DICOM por arquivo            | 50 MB                                                                                 |
| PDF / JPEG / PNG / WebP      | 4 MB                                                                                  |
| Caso                         | 64 arquivos e 256 MB, incluindo reservas de upload ativas                             |
| DICOM individual             | 64 frames, 32 milhões de amostras (pixels × frames × canais)                          |
| Dimensões originais          | Até 8192 por eixo, sujeito ao orçamento de amostras                                   |
| Janelas                      | Até 3 por frame                                                                       |
| Imagens para IA              | Até 64 frames/janelas no caso inteiro                                                 |
| PNGs extraídos               | Até 20 MB por caso; prévias individuais até 4 MB                                      |
| Prévia / imagem enviada à IA | PNG de 8 bits, até 1024 px, sem metadados DICOM de identificação                      |
| Worker                       | Até 45 segundos por operação; orçamento total da análise compartilhado com o provedor |

Não há seleção automática de frames representativos. Se o estudo exceder o limite, a análise inteira falha antes de chamar a IA. Isso evita afirmar que uma série completa foi analisada quando apenas algumas imagens foram enviadas. Estudos maiores exigem um fluxo assíncrono ampliado, não implementado nesta versão.

As renderizações para IA não preservam a profundidade quantitativa ou toda a resolução do original. Na ausência de janela, usa-se min/max dos pixels e essa limitação é informada. Não são um visualizador diagnóstico, reconstrução 3D ou validação da precisão da IA. A revisão clínica deve considerar os arquivos originais.

## Metadados e privacidade

São persistidos: sintaxe, classe de objeto, modalidade, dimensões, bits, fotometria, frames, rescale, janelas, espaçamento, orientação, indicação de texto queimado nos pixels e contagem de imagens. Tags de nome/ID do paciente não são copiadas para o prompt ou metadados técnicos; o original, que pode contê-las, permanece privado. Isso não constitui anonimização de imagens.

O worker recebe um diretório temporário exclusivo, não registra stdout/stderr do codec e tem seus temporários removidos pelo processo pai em sucesso, erro ou timeout. A capacidade de upload assinada não permite sobrescrever o original confirmado. O cancelamento é serializado com a finalização no banco. Agende a limpeza de uploads abandonados descrita em `DEPLOY.md`.

## Instalação e testes

Aplique as migrações na ordem dos nomes; bancos existentes recebem somente `202610290001_dicom.sql`. Não reexecute a migração inicial em um banco já configurado.

```sh
npm ci
npm test
npm run build
npm run verify:dicom-runtime
npm run test:e2e
```

`verify:dicom-runtime` copia somente os arquivos rastreados pelo build Next/Vercel para uma pasta isolada e decodifica um DICOM sintético multiframe. Comprova que o worker, suas dependências e assets WASM estão no artefato, sem depender dos `node_modules` originais. Nenhuma chave xAI é necessária para esses testes. A chamada real ao Grok continua pendente da chave do proprietário.
