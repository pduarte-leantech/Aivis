# Avaliação e evidências

Avaliação realizada em 25/10/2026. As notas abaixo são uma autoavaliação técnica, não certificação independente. Uma nota de interface ou teste local não demonstra prontidão clínica, segurança completa ou disponibilidade dos serviços externos.

## Resultados executados

- `npm ci`: instalação repetível pelo lockfile, Node.js 24.
- `npm run typecheck`: passou.
- `npm run lint`: passou, sem alertas.
- `npm test`: **33 testes passaram**, em 5 arquivos. Validação de entrada, formatos, preservação de símbolos clínicos em PDF, corpos limitados, autorização, isolamento, tratamento da IA, PDF, versão, aprovação e SQL.
- `npm run build`: build de produção passou.
- `npm run test:e2e`: **12 testes passaram**: navegação, busca, edição/salvamento/aprovação, recusa, criação/upload/análise simulada, equipe, chaves, ausência de overflow, axe WCAG A/AA e respostas de segurança; versões desktop e móvel.
- `npm audit --omit=dev --audit-level=moderate`: nenhuma vulnerabilidade conhecida reportada nas dependências de runtime no momento da execução. Não é pentest.
- Lighthouse **13.5.0**, Chromium local, build de produção, perfil móvel padrão, uma navegação: **performance 99**, **acessibilidade 100**, **boas práticas 100**. FCP 0,8 s, LCP 2,0 s, TBT 20 ms, CLS 0, speed index 0,8 s. Não é medição de usuários reais ou teste de carga.

Os testes de banco aplicam a migração em PostgreSQL embutido (PGlite), com substitutos mínimos de Auth/Storage. Os testes da IA usam respostas controladas e comprovam tratamento de erros e formato; não comprovam precisão diagnóstica. A demonstração é explicitamente identificada e todos os PDFs fictícios recebem marcação de ausência de validade clínica.

## Notas atuais de 0 a 10

| Quesito                              | Nota | Evidência e limite                                                                                                                  |
| ------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Design e consistência visual         | 9    | Interface original, minimalista, sem emojis; revisão visual em desktop e celular                                                    |
| Experiência de revisão médica        | 9    | Edição, prévia, bloqueio de aprovação com alteração não salva, confirmação e documento imutável                                     |
| Funcionalidade demonstrativa         | 9    | Fluxos principais exercitados por E2E; não confundir com serviços reais                                                             |
| Acessibilidade automatizada          | 10   | axe WCAG A/AA sem violações e Lighthouse 100; não houve avaliação humana com leitores de tela                                       |
| Performance local                    | 9,9  | Lighthouse 99, sem CLS; banco remoto, IA e carga de produção não medidos                                                            |
| Organização e manutenção             | 9    | Componentes separados, TypeScript estrito, validação centralizada, lockfile, migração e CI                                          |
| Segurança para operação clínica real | 8    | Isolamento e controles testados; faltam aceitação real Auth/Storage, MFA/SSO e avaliação independente                               |
| Prontidão de produção ponta a ponta  | 5    | Código e build prontos; conexão Supabase, configuração operacional e aceitação real ainda dependem de credenciais e provisionamento |
| Validação clínica da IA              | 0    | Não realizada; não se atribui nota de precisão sem um estudo clínico apropriado                                                     |

**A meta de 9 em todos os quesitos ainda não foi atingida.** Atribuir 9 à operação clínica enquanto integrações e validação não foram verificadas seria enganoso. A ausência da chave xAI foi aceita pelo proprietário para esta etapa: a integração está implementada e desabilitada, sem fallback para resultados clínicos inventados.

## Aceitação pendente

1. Confirmar acesso de gerenciamento ao Supabase, criar projeto em São Paulo e aplicar a migração.
2. Configurar Auth/SMTP e identidade administrativa, verificar autorização entre duas organizações e testar upload/download reais.
3. Configurar variáveis sensíveis na Vercel, verificar domínio final e origem, backups/restauração, retenção e plano comercial adequado.
4. Autorizar o aplicativo Vercel para o repositório GitHub para habilitar deploys automáticos, se a conexão retornar falta de acesso.
5. Quando houver chave xAI, testar análise real com dados fictícios antes de habilitar processamento clínico.
6. Antes do uso assistencial, realizar avaliação clínica, jurídica/regulatória, MFA/SSO e revisão independente de segurança. Os testes de software não substituem essas etapas.

Os comandos e critérios de aceitação ficam em [DEPLOY.md](DEPLOY.md). O relatório deve ser atualizado com resultados reais, preservando a distinção entre aprovado, falhou e não executado.

## Publicação e repositório

O código foi enviado à branch `main` de `pduarte-leantech/Aivis`. A Vercel confirmou o deploy de produção em https://aivis-ten-theta.vercel.app, no escopo `pedro-borges-projects`. O primeiro deploy foi criado por CLI; a vinculação automática com GitHub retornou falta de permissão da instalação Vercel sobre o repositório. O teste HTTP remoto deste ambiente foi bloqueado pela política de egress (CONNECT 403); isso é distinto de uma falha HTTP observada na aplicação. O build e os fluxos locais foram exercitados; confirmar também a navegação no domínio publicado.

## Atualização DICOM — 29/10/2026

- **58 testes passaram em 7 arquivos**, incluindo extração real com ITK/GDCM e Sharp, sem mockar os pixels do decoder: nativos LE/BE, signed pixels, rescale, MONOCHROME1, multiframe, múltiplas janelas, LINEAR_EXACT/SIGMOID, RGB, JPEG Baseline e RLE. Entradas inválidas e estudos que excedem o orçamento são recusados.
- O teste de integração com um provedor simulado confirmou que **todos os frames viram PNGs reais** no payload, sem enviar o DICOM binário ou copiar tags do paciente para o prompt. O caso que excede o orçamento não chama o provedor.
- **14 testes de navegador passaram**, em desktop e celular, incluindo upload `.DICOM` com MIME genérico e a prévia dedicada da demonstração. Os testes de acessibilidade continuam sem violações nos alvos exercitados.
- TypeScript, lint, build e auditoria de dependências de runtime passaram. O override documentado do descompactador transitivo eliminou a vulnerabilidade reportada, sem desabilitar verificações.
- `verify:dicom-runtime` copiou somente os arquivos rastreados no artefato Next/Vercel e decodificou dois frames sintéticos fora do checkout, comprovando inclusão do worker, dependências e WASM.
- A interface usa Lucide SVG e a revisão dos componentes não encontrou emojis. A medição Lighthouse registrada acima é a referência de 25/10; não foi reapresentada como uma nova medição desta atualização.
- A migração incremental foi executada nos testes PostgreSQL, incluindo quotas, confirmação idempotente, bloqueio de análise com upload pendente e proteção contra cancelar um exame confirmado. O Supabase real e a chamada real ao Grok permanecem pendentes de credenciais.

Para ativar no banco existente, aplique `202610290001_dicom.sql`; projetos novos aplicam as duas migrações em ordem. A publicação desta atualização ainda depende do acesso à API da Vercel: nesta sessão a conexão retornou `CONNECT 403` na política de rede, antes de chegar à aplicação.
