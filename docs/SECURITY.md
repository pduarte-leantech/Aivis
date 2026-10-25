# Arquitetura e segurança

## Fronteiras de confiança

- O navegador não recebe service_role ou chave xAI. Conteúdo clínico é renderizado como texto pelo React, sem HTML fornecido pelo usuário.
- O servidor obtém a identidade com `Supabase Auth.getUser()`, verifica vínculo, papel e cliente antes de cada operação. Toda consulta clínica inclui `tenant_id`. IDs de cliente no corpo são rejeitados.
- Chaves usam 256 bits aleatórios, hash SHA-256, escopos, validade e comparação em tempo constante. O cabeçalho de cliente não altera a organização da chave.
- RLS está habilitada em todas as tabelas. Navegadores não têm grants nas tabelas clínicas. As únicas leituras diretas permitidas são dos próprios vínculos e organizações, protegidas por RLS. O serviço privilegiado é uma fronteira crítica: sua chave precisa ser protegida e rotacionada.
- Bucket privado, nomes internos aleatórios, sem política de Storage pública. Downloads passam pelo servidor autorizado; exames originais são entregues como anexo, com CSP restritiva. A validação de assinatura de arquivo é uma barreira básica, não um antivírus.
- Corpos de requisição são limitados antes de JSON/multipart, incluindo transferências sem `Content-Length`. Arquivos de até 4 MB, 8 por caso, 20 MB totais, com quotas protegidas por lock no banco.
- Limites de requisições e de análise ficam em PostgreSQL, compartilhados entre instâncias. A análise usa token de execução, timeout e trava com expiração. Uploads são serializados contra a análise.
- O prompt trata exames e anamnese como dados não confiáveis, exige incertezas e não permite aprovação automática. A saída é validada com Zod. Isso reduz, mas não elimina, prompt injection, alucinações e erros clínicos.
- Aprovação acontece em uma função PostgreSQL com vínculo/registro profissional, versão e estado validados, com auditoria na mesma transação. Chaves e perfis de consulta são proibidos. O registro profissional informado deve ser verificado administrativamente; não há integração com conselho de medicina.
- O PDF final é armazenado antes da aprovação, tem hash SHA-256 e é verificado a cada download. Um conflito remove o artefato não aprovado. Revisões anteriores e eventos são append-only pelo aplicativo.
- Origem canônica nas mutações de sessão, cookies HttpOnly/SameSite=Lax/Secure em produção, sem CORS permissivo. CSP, proteção contra MIME sniffing, enquadramento restrito e HSTS.
- Logs de erro contêm somente a classe de erro. A auditoria guarda IDs e metadados mínimos. Motivos de recusa e versões podem conter dados pessoais e exigem os mesmos cuidados do prontuário.

## Modelo operacional

O banco mantém exames originais, anamnese, hipóteses, modelo e consumo de tokens na auditoria, versões e decisão humana. O PDF não representa assinatura digital, certificação, autorização regulatória ou diagnóstico autônomo. Aprovação humana não é sinônimo de validação clínica do modelo.

Antes de pacientes reais, estabelecer base legal, transparência, contratos de operadores, transferência internacional, política de retenção e exclusão, backups/restauração, controle de acesso periódico, MFA/SSO, monitoramento, resposta a incidentes e avaliação regulatória. A região de São Paulo refere-se ao Supabase; não promete que o processamento de IA ficará no Brasil.

Não registrar PHI em ferramentas de analytics, screenshots de CI, observabilidade de corpo de requisição ou logs da Vercel. Usar apenas fixtures fictícias nos testes. Previews devem usar bancos separados. Evitar caches de respostas clínicas: a API usa `private, no-store`.

## Limites atuais

Sem pentest independente, validação clínica, DICOM, antivírus, MFA, gestão de chaves por cliente, assinatura ICP-Brasil, política automatizada de expurgo ou prova de recuperação em produção. O processo de retificação é um novo caso, não a edição do documento aprovado. Um administrador de infraestrutura ainda pode alterar dados diretamente; append-only no aplicativo não é armazenamento WORM inviolável.

O cadastro de organizações e a associação de usuários existentes a novos clientes são procedimentos administrativos. O histórico anterior ao relatório final é visível apenas na plataforma ao cliente autorizado; o consumidor da API deve proteger esses dados como informação de saúde.
