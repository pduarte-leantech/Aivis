# API v1

Base: `https://SEU-DOMINIO/api/v1`. Requisições de integração usam `Authorization: Bearer aiv_...`. Nunca envie a chave no navegador do cliente ou em query string. O cliente é derivado da chave, não do corpo da requisição. Integrações não aprovam nem editam relatórios; essas ações exigem sessão médica.

Chaves são criadas por administradores na plataforma, exibidas uma vez, armazenadas apenas como SHA-256, expiram em 90 dias e podem ser revogadas. Escopos: `cases:read` e `cases:write`. Limites: 60 requisições por minuto por chave, 20 análises por hora por organização; respostas `429` sinalizam o limite. Aguarde a próxima janela antes de repetir. Não repita uma criação automaticamente após erro de rede sem consultar os casos, pois não existe chave de idempotência para criação.

## Fluxo de integração

```sh
# Declare AIVIS_URL e AIVIS_API_KEY no ambiente seguro do seu servidor.
# Não habilite `set -x` em scripts que usam credenciais.
curl --fail-with-body "$AIVIS_URL/api/v1/cases" \
  -H "Authorization: Bearer $AIVIS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"patient_name":"Paciente fictício","patient_code":"TEST-001","anamnesis":"Paciente exclusivamente fictício com histórico clínico suficiente para testar a integração."}'
```

Resposta `201`: objeto do caso, incluindo `id`, `status: "pending"` e `revision: 1`. `birth_date` aceita `YYYY-MM-DD`, opcional.

```sh
# Substitua CASE_ID pelo id retornado. O arquivo deve ser válido.
curl --fail-with-body "$AIVIS_URL/api/v1/cases/CASE_ID/upload" \
  -H "Authorization: Bearer $AIVIS_API_KEY" \
  -F 'file=@exame-ficticio.pdf'

curl --fail-with-body "$AIVIS_URL/api/v1/cases/CASE_ID/analyze" \
  -H "Authorization: Bearer $AIVIS_API_KEY" \
  -H 'Content-Type: application/json' -d '{"consent":true}'
```

A análise é síncrona, pode levar até 120 segundos e devolve `status: "review"`, modelo e versão. O conteúdo do rascunho fica restrito à plataforma; integrações recebem `report: null` até a aprovação médica. Em caso de erro, o caso é preservado; consulte seu status antes de tentar novamente. Não faça polling frequente nem dispare análises concorrentes.

```sh
curl --fail-with-body "$AIVIS_URL/api/v1/cases/CASE_ID" \
  -H "Authorization: Bearer $AIVIS_API_KEY"

# Depois da revisão e aprovação humana na plataforma:
curl --fail-with-body "$AIVIS_URL/api/v1/cases/CASE_ID/pdf" \
  -H "Authorization: Bearer $AIVIS_API_KEY" -o relatorio.pdf
```

O endpoint de PDF retorna `403` para integrações enquanto o relatório não estiver aprovado. Nenhum e-mail ou webhook é enviado automaticamente; o sistema consumidor pode consultar o caso e obter o documento após aprovação.

## Endpoints

| Método   | Caminho                         | Acesso / resultado                                                                            |
| -------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| GET      | `/me`                           | Identidade e cliente da chave; vínculos da sessão                                             |
| GET      | `/cases?offset=0&status=review` | Lista paginada de 50 itens; `cases`, `total`, `offset`, `page_size`                           |
| POST     | `/cases`                        | Criar caso; não aceita `tenant_id` ou `status` fornecidos pelo consumidor                     |
| GET      | `/cases/:id`                    | Caso, relatório, exames e metadados do cliente autorizado                                     |
| POST     | `/cases/:id/upload`             | Multipart `file`; DICOM/PDF/JPEG/PNG/WebP até 4 MB (legado); arquivos maiores usam `/uploads` |
| POST     | `/cases/:id/analyze`            | `{"consent":true}`; processamento precisa estar habilitado no servidor                        |
| GET      | `/cases/:id/exams?exam_id=UUID` | Download privado; DICOM usa redirecionamento 307 para URL assinada de 60 s                    |
| GET      | `/cases/:id/history`            | **Sessão**: versões anteriores, para o cliente autorizado                                     |
| GET      | `/cases/:id/pdf`                | PDF final para integrações; sessão pode ver rascunho                                          |
| GET      | `/stats`                        | Totais exatos e 12 meses de indicadores, isolados por cliente                                 |
| PATCH    | `/cases/:id/report`             | **Sessão médica**: `{"revision":N,"report":{...}}`                                            |
| POST     | `/cases/:id/approve`            | **Sessão médica**: `{"revision":N,"confirmed":true}`                                          |
| POST     | `/cases/:id/reject`             | **Sessão médica**: `{"revision":N,"reason":"Motivo com pelo menos 10 caracteres"}`            |
| GET/POST | `/members`                      | **Sessão administrativa**: consultar/convidar novos profissionais                             |
| GET/POST | `/keys`                         | **Sessão administrativa**: listar/criar chaves                                                |
| DELETE   | `/keys/:id`                     | **Sessão administrativa**: revogar chave                                                      |
| GET      | `/audit`                        | **Sessão administrativa**: até 100 eventos recentes                                           |

O relatório contém exatamente cinco campos: `summary`, `findings`, `hypotheses`, `limitations`, `recommendations`. Todos obrigatórios, com no mínimo 10 caracteres. Limites respectivos: 6.000, 12.000, 8.000, 6.000, 8.000 caracteres. Alterações exigem a revisão atual; `409` exige recarregar, nunca sobrescrever silenciosamente.

Sessões multiorganização selecionam `x-tenant-id`; o servidor verifica que o usuário pertence à organização. Mutações por cookies exigem `Origin` igual ao `APP_URL`. Uma chave de integração pertence a apenas um cliente e não pode escolher outro tenant por cabeçalhos.

## Erros

```json
{ "error": "Mensagem segura para o consumidor." }
```

Erros de validação podem incluir `details: [{"field":"anamnesis","message":"..."}]`. Códigos: `400` JSON/ID inválido, `401` sem autenticação/chave inválida, `403` sem permissão, `404` recurso não encontrado no cliente, `409` concorrência/estado incompatível, `413` corpo muito grande, `422` dados/arquivos inválidos, `429` limite, `502` provedor/arquivo incompatível, `503` configuração/serviço indisponível e `504` timeout. Falhas não devem ser interpretadas como aprovação.

## DICOM e upload direto de arquivos grandes

Use esse fluxo para `.dicom`/`.dcm` de até 50 MB e também para os outros formatos. A extensão é normalizada para `application/dicom` quando o navegador não conhece o MIME. Arquivos comuns continuam limitados a 4 MB. A soma de exames e reservas ativas é limitada a 64 arquivos/256 MB por caso.

1. `POST /cases/:id/uploads` com JSON `{"name":"exame.dicom","mime_type":"application/dicom","size":12345678}`. Retorna `201` com `upload_id`, `signed_url`, `expires_at` e `mime_type`. Não registre a URL assinada em logs.
2. Envie os bytes para `signed_url` com método **PUT**, `Content-Type: application/dicom` e `x-upsert: false`. A URL autoriza somente o caminho reservado; não precisa de service_role no navegador.
3. `PATCH /cases/:id/uploads` com `{"upload_id":"UUID"}` confirma o upload. O servidor verifica tamanho real, formato, cabeçalho e limites DICOM antes de inserir o exame. A confirmação é idempotente. Um objeto enviado sem confirmação não aparece nos casos nem entra na análise.
4. Se o envio falhar, `DELETE /cases/:id/uploads` com o mesmo JSON cancela a reserva e remove o objeto temporário. Uma reserva confirmada não pode ser cancelada ou ter seu original removido por esse endpoint.

A reserva expira em 15 minutos. Novas análises são bloqueadas enquanto houver reservas ativas, evitando análise incompleta de arquivos ainda em trânsito. Objetos abandonados precisam da limpeza periódica descrita no guia de implantação.

`GET /cases/:id/dicom?exam_id=UUID&frame=0&window=0` retorna um PNG privado do frame/janela selecionado, com autenticação e isolamento por cliente. Índices começam em zero. Os metadados do exame informam `frames`, `frame_windows`, `transfer_syntax`, dimensões, bits, modalidade, espaçamento e número de imagens extraídas. A prévia não equivale a um visualizador diagnóstico.

Na análise, cada frame/janela suportado vira uma imagem PNG para o Grok. Nenhum DICOM binário é enviado como se fosse JPEG. Limites: 64 frames e 32 milhões de amostras por arquivo, 64 imagens/janelas e 20 MB de imagens renderizadas por análise. Se excedidos, o caso inteiro é recusado antes da chamada ao provedor; não há amostragem silenciosa. O orçamento de tempo da análise é compartilhado entre extração e chamada ao provedor.
