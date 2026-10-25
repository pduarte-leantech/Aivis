# Implantação: Supabase, Vercel e Grok

## 1. Supabase em São Paulo

A conta do proprietário precisa autorizar a criação. Se o projeto ainda não existir, crie em sua organização com região **South America / São Paulo (`sa-east-1`)**. Não selecione uma região diferente como fallback silencioso.

1. Em SQL Editor, execute o arquivo completo `supabase/migrations/202610250001_initial.sql` **uma vez**. Alternativa: `supabase link --project-ref SEU_REF` e `supabase db push` com autenticação segura.
2. Confirme que o bucket `clinical-files` é privado, com limite de 4 MB. Não adicione políticas públicas de Storage.
3. Em Authentication, desative cadastro público. Configure Site URL com o domínio final da Vercel e a URL de redirecionamento `/auth/callback`.
4. Configure SMTP de produção, proteção contra senhas comprometidas e limites de autenticação. Não dependa do serviço de e-mail de desenvolvimento para clientes.
5. Para aceitar convites com SSR, configure o template **Invite user** com o link:

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite"
     >Aceitar convite</a
   >
   ```

   O template **Reset password** pode usar o mesmo formato com `type=recovery`. O link cria uma sessão e abre `/access` para definir senha; não recebe uma URL de retorno arbitrária.

6. Em Authentication > Users, crie a conta `pedronovikovborges@gmail.com` com uma senha forte entregue de forma segura pelo operador. Não registre senhas em SQL, documentos ou Git.
7. Preencha as variáveis Supabase em `.env.local` e execute:

   ```sh
   npm run bootstrap:admin
   ```

   O script é repetível: não duplica um vínculo administrativo existente. Não envia e-mail nem atribui CRM fictício. Para aprovação, cadastre o registro profissional verdadeiro do médico em `memberships.professional_registration`, após verificação administrativa. Se Pedro não for médico, mantenha seu registro vazio e convide um médico habilitado.

8. Cada cliente deve ter sua própria linha em `tenants`; vincule profissionais em `memberships`. Nunca reutilize `tenant_id` de um cliente para outro. Uma pessoa pode pertencer a várias organizações. Convites de novos usuários são realizados pela tela de equipe. Para vincular uma identidade já existente a outro cliente, use um procedimento administrativo no banco; a interface de convites não faz essa associação automaticamente.

## 2. Variáveis na Vercel

Importe `pduarte-leantech/Aivis`, framework **Next.js**, Node.js **24**, branch de produção **main**. O projeto criado durante esta tarefa pertence ao escopo `pedro-borges-projects` e chama-se `aivis`.

A autorização da Vercel e a autorização do aplicativo Vercel para o repositório GitHub são independentes. Se a conexão retornar falta de acesso, instale/autorize o aplicativo Vercel na organização `pduarte-leantech` com acesso ao repositório Aivis, e conecte-o em Project > Settings > Git. Não é necessário tornar o código público.

Adicione em Project > Settings > Environment Variables, para os ambientes corretos:

| Nome                            | Valor / origem                                                     | Visibilidade                   |
| ------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | URL do projeto                                                     | Público                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable/anon key compatível com o SDK                          | Público                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | Chave service_role do projeto                                      | **Somente servidor, sensível** |
| `XAI_API_KEY`                   | Chave da sua conta xAI                                             | **Somente servidor, sensível** |
| `XAI_MODEL`                     | `grok-4-1-fast-reasoning` ou modelo multimodal habilitado na conta | Servidor                       |
| `AI_PROCESSING_ENABLED`         | `false` inicialmente; `true` após autorizar o processamento        | Servidor                       |
| `APP_URL`                       | Origem canônica exata, como `https://SEU-DOMINIO` sem barra final  | Servidor                       |

Não use variáveis com prefixo `NEXT_PUBLIC_` para segredos. Não copie placeholders de segredos do proxy deste ambiente para a Vercel: cadastre as chaves reais diretamente na interface segura da Vercel. O token de gerenciamento Supabase usado durante o provisionamento **não pertence ao runtime da aplicação**.

Depois de alterar variáveis públicas, refaça o deploy. `APP_URL` é obrigatório em produção para proteger mutações por cookies. Um preview em outro domínio deve ter seu próprio `APP_URL` e seu próprio projeto Supabase de testes; não reutilize o banco de pacientes em previews de PRs.

Sem Supabase configurado, o deploy abre uma demonstração explícita. Isso não prova que o banco ou a IA estejam conectados.

## 3. Grok

O endpoint é `https://api.x.ai/v1/chat/completions`, com mensagens multimodais, JSON validado e timeout de 100 segundos. A disponibilidade do modelo depende da conta. Um erro do provedor preserva o caso para nova tentativa; nunca gera um relatório clínico fictício no ambiente real.

Para verificar, use um caso inteiramente fictício com uma imagem válida ou PDF textual, marque a autorização de processamento e execute a análise. Confira achados, limitações, edição, versão, aprovação, PDF e auditoria. Verifique na xAI o consumo e a política de tratamento de dados antes de habilitar uso clínico.

## 4. Aceitação do ambiente real

Execute os seguintes testes com **dados fictícios**, sem pular erros:

- Login do administrador; convite e definição de senha de um médico; logout e expiração da sessão.
- Dois clientes e duas contas: a conta A não consegue consultar caso, exame ou PDF de B, mesmo conhecendo o UUID.
- Papel de consulta não edita; médico sem CRM não aprova; chave de API não aprova.
- Upload válido e rejeição de arquivo fora do limite; PDF digitalizado sem texto gera orientação explícita.
- Análise real no Grok, custo registrado e resposta incompatível tratada como erro.
- Duas edições concorrentes retornam conflito; somente uma aprovação é registrada.
- Download do PDF final na interface e pela API; hash confere; conteúdo aprovado não muda.
- Revogação e expiração de chave; limite por minuto e por hora; agregações mensais.
- SMTP, backups, restauração, logs sem conteúdo clínico, política de retenção e recuperação de incidentes.

A Vercel identificou o plano atual como Hobby. Confira os termos e escolha um plano adequado antes de operar o serviço comercial. As funções usam `maxDuration=120`, devendo ser compatível com os limites do plano selecionado.

## Se você não encontrar onde adicionar o token neste chat

O token de gerenciamento Supabase é diferente das chaves do projeto e só é necessário para automatizar o provisionamento. Não o cole na conversa, em arquivos versionados nem no front-end. O requisito salvo chama-se `SUPABASE_ACCESS_TOKEN`, com destino `api.supabase.com`. Se a interface de configurações deste ambiente não disponibilizar um campo seguro para esse requisito, use o caminho manual, sem fornecer o token ao agente:

1. Acesse `https://supabase.com/dashboard/new` com sua conta. Crie o projeto Aivis, região São Paulo, e guarde a senha do banco em um gerenciador.
2. Execute a migração no SQL Editor do projeto e configure o usuário inicial como descrito acima.
3. Abra o projeto Aivis na sua conta Vercel: Settings > Environment Variables. Cadastre a URL, anon key e service_role do Supabase. O access token da conta Supabase não é necessário nessa configuração.
4. Mantenha `AI_PROCESSING_ENABLED=false`. A chave xAI pode ser adicionada depois, sem alterar código.
5. Defina `APP_URL` com o domínio de produção, refaça o deploy e execute os testes de aceitação.

A URL pública do projeto e seu identificador não são segredos. Chaves service_role, senha do banco, access token e chave xAI são segredos e devem permanecer nos campos seguros dos respectivos serviços. Salvar uma credencial em outro projeto ou painel não a injeta automaticamente neste ambiente.
