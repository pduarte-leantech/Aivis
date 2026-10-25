# Aivis

Plataforma de apoio à decisão clínica, com anamnese, exames, análise por Grok, revisão médica, PDF e API multiempresa. Interface em português, sem dependências externas de fontes ou imagens.

**Estado:** aplicação e demonstração local implementadas. Não considerar os serviços reais conectados até completar [DEPLOY.md](docs/DEPLOY.md) e os testes de aceitação. O modo demonstrativo usa exclusivamente dados fictícios em memória; não chama a IA, não envia convites, não mantém histórico persistente e não grava arquivos de pacientes.

## Testar em cinco minutos

Requisitos: Node.js 24 e npm. No checkout existente:

```sh
npm ci
npm run dev
```

Abra a porta 3000 no seu navegador local. Sem as variáveis do Supabase, a plataforma abre em demonstração. Nenhuma chave é necessária para explorar a interface.

1. Em **Casos clínicos**, abra o primeiro caso em revisão.
2. Edite a síntese, salve e confira **Visualizar PDF**.
3. Aprove com confirmação ou recuse com um motivo.
4. Baixe o PDF. Os documentos demonstrativos são marcados como fictícios e sem validade clínica.
5. Crie um caso, adicione um arquivo fictício, marque a confirmação e simule a análise.
6. Explore o painel, equipe, API e auditoria. Recarregar a página restaura a demonstração.

## Ambiente real

Copie `.env.example` para `.env.local`, preencha as variáveis **sem comitar valores** e siga [o guia de implantação](docs/DEPLOY.md). Há três integrações independentes:

- **Supabase:** PostgreSQL, Auth e Storage privado. A migração fica em `supabase/migrations/`.
- **Grok / xAI:** API chamada exclusivamente no servidor. O processamento fica bloqueado até `AI_PROCESSING_ENABLED=true`.
- **Vercel:** aplicação Next.js com funções Node. Os serviços externos não são emulados silenciosamente em produção.

O administrador inicial solicitado é `pedronovikovborges@gmail.com`; a região escolhida é São Paulo (`sa-east-1`). O script de bootstrap vincula uma identidade já criada no Supabase, sem criar senhas nem enviar mensagens. O CRM real de cada médico deve ser cadastrado e verificado antes de habilitar a revisão.

## Validação

```sh
npm run typecheck
npm run lint
npm test
npm audit --omit=dev --audit-level=moderate
npm run build
npm run test:e2e
```

Os testes de banco usam PostgreSQL embutido (PGlite), com os schemas `auth` e `storage` mínimos para aplicar a migração real. Eles verificam SQL, RLS, vínculos, aprovação transacional, histórico, quotas e contagens. **Não substituem testes com Supabase Auth/Storage reais.**

Os testes E2E usam build de produção, Chromium e versões desktop/móvel. Neste ambiente, Chromium está em `/usr/bin/chromium`; em outra máquina, execute `npx playwright install chromium` e indique `CHROMIUM_PATH`, ou use `CI=true` com os navegadores do Playwright. Sempre encerre o servidor que você iniciou antes de refazer o build e testar outra versão. A CI prepara seu próprio navegador e servidor.

## O que está incluído

- Clientes com múltiplos profissionais, papéis de administrador, médico e consulta.
- Isolamento de dados por cliente na autorização do servidor; acesso direto às tabelas clínicas negado a navegadores.
- Upload privado de PDF com texto, JPEG, PNG e WebP; assinatura do arquivo, quotas e tamanho validados.
- Análise por Grok, saída validada, bloqueio de execução concorrente e limitação de consumo.
- Edição do conteúdo estruturado com regeneração do PDF, controle de versão e prevenção de sobrescrita concorrente.
- Aprovação exclusiva de sessão médica com registro profissional; documento aprovado imutável, com hash SHA-256 verificado no download.
- Disponibilização na plataforma e na API. Envio de e-mail/webhooks de relatórios não está implementado.
- Indicadores exatos por cliente, histórico mensal de 12 meses e totais sem limite de amostragem.
- Chaves de integração por cliente, escopos, hash, expiração em 90 dias, revogação e limite de requisições compartilhado no banco.
- Trilha de auditoria e histórico de versões com proteção contra alteração pelo aplicativo.

## Limites explícitos

- Não é um dispositivo clínico validado e não realiza diagnóstico autônomo. A saída é um rascunho para o médico. A exatidão clínica não é demonstrada pelos testes de software.
- PDF é um documento gerado a partir do conteúdo editável; não é um editor de PDFs arbitrários importados. PDFs de exames fornecem somente texto. Imagens internas precisam ser enviadas separadamente. DICOM e OCR de PDF digitalizado não estão incluídos.
- Até 4 MB por arquivo, 8 arquivos e 20 MB por caso; PDFs de até 30 páginas e 60 mil caracteres extraídos. APIs de upload respeitam o limite de payload da Vercel.
- Um relatório aprovado não pode ser reaberto. Para retificação, crie um novo caso com referência ao anterior na anamnese. Assinatura digital ICP-Brasil não está implementada.
- Busca na interface se aplica aos 50 casos da página atual. A API oferece paginação. O painel usa agregações de toda a organização.
- A região do Supabase não estabelece residência dos dados na xAI ou Vercel. Revisão de contratos, transferência internacional, retenção, consentimento/base legal, backups e requisitos regulatórios são necessários antes de pacientes reais.
- Ainda não há MFA no aplicativo, processo de exclusão/anonimização, gestão de cobrança ou painel de superadministrador para criar clientes. Um operador provisiona organizações pelo banco. Os limites de consumo são fixos.

[API](docs/API.md) · [Implantação](docs/DEPLOY.md) · [Arquitetura e segurança](docs/SECURITY.md) · [Avaliação e evidências](docs/QUALITY.md)
