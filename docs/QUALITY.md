# Avaliação e evidências

Avaliação realizada em 25/10/2026. As notas abaixo são uma autoavaliação técnica, não certificação independente. Uma nota de interface ou teste local não demonstra prontidão clínica, segurança completa ou disponibilidade dos serviços externos.

## Resultados executados

- `npm ci`: instalação repetível pelo lockfile, Node.js 24.
- `npm run typecheck`: passou.
- `npm run lint`: passou, sem alertas.
- `npm test`: **32 testes passaram**, em 5 arquivos. Validação de entrada, formatos, corpos limitados, autorização, isolamento, tratamento da IA, PDF, versão, aprovação e SQL.
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
