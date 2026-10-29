import { NextResponse } from 'next/server';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  authorize,
  ApiError,
  audit,
  requireAdmin,
  requirePhysician,
  type Access,
} from '@/lib/auth';
import { caseSchema, reportSchema, uploadSchema } from '@/lib/validation';
import { boundedBody, readJson } from '@/lib/body';
import { generateServerPdf } from '@/lib/pdf-server';
import { PdfContentError } from '@/lib/pdf';
import { analyzeWithGrok } from '@/lib/grok';
import type { ClinicalCase } from '@/lib/types';
import { processDicom } from '@/lib/dicom';
import { DICOM_MIME, normalizeExamMime, MAX_EXAMS } from '@/lib/upload-policy';
import {
  reserveExamUpload,
  finishExamUpload,
  cancelExamUpload,
  validateExamContent,
} from '@/lib/exam-uploads';
import { exposeCase } from '@/lib/serialization';
export const runtime = 'nodejs';
export const maxDuration = 120;
const noStore = { 'Cache-Control': 'private, no-store' };
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: noStore });
}
function dbError(error: unknown) {
  if (error) throw new ApiError(503, 'Não foi possível concluir a operação no banco de dados.');
}
async function getCase(a: Access, id: string) {
  if (!z.uuid().safeParse(id).success) throw new ApiError(400, 'Identificador inválido.');
  const { data, error } = await a.db
    .from('cases')
    .select('*,exams(*)')
    .eq('tenant_id', a.tenantId)
    .eq('id', id)
    .maybeSingle();
  dbError(error);
  if (!data) throw new ApiError(404, 'Caso não encontrado.');
  return data as ClinicalCase;
}
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await params;
    const [resource, id, action] = path;
    if (path.length > 3) throw new ApiError(404, 'Rota não encontrada.');
    const a = await authorize(request, request.method === 'GET' ? 'cases:read' : 'cases:write');
    if (resource === 'me' && request.method === 'GET') {
      if (a.apiKeyId) return json({ tenant_id: a.tenantId, authentication: 'api_key' });
      const { data, error } = await a.db
        .from('memberships')
        .select('tenant_id,role,display_name,professional_registration,tenants(name)')
        .eq('user_id', a.userId);
      dbError(error);
      return json({ user_id: a.userId, tenant_id: a.tenantId, memberships: data });
    }
    if (resource === 'stats' && request.method === 'GET') {
      const { data, error } = await a.db.rpc('dashboard_stats', { p_tenant: a.tenantId });
      dbError(error);
      return json(data);
    }
    if (resource === 'audit' && request.method === 'GET') {
      requireAdmin(a);
      const { data, error } = await a.db
        .from('audit_events')
        .select('id,action,case_id,created_at,actor_id,metadata')
        .eq('tenant_id', a.tenantId)
        .order('created_at', { ascending: false })
        .limit(100);
      dbError(error);
      return json({ events: data });
    }
    if (resource === 'members') {
      requireAdmin(a);
      if (request.method === 'GET') {
        const { data, error } = await a.db
          .from('memberships')
          .select('user_id,display_name,role,professional_registration,created_at')
          .eq('tenant_id', a.tenantId);
        dbError(error);
        return json({ members: data });
      }
      if (request.method === 'POST') {
        const body = z
          .object({
            email: z.email(),
            display_name: z.string().trim().min(2).max(160),
            role: z.enum(['admin', 'physician', 'viewer']),
            professional_registration: z.string().trim().min(3).max(80).optional(),
          })
          .strict()
          .parse(await readJson(request));
        if (body.role === 'physician' && !body.professional_registration)
          throw new ApiError(422, 'Informe o registro profissional.');
        await audit(a, 'member.invite_requested');
        const { data, error } = await a.db.auth.admin.inviteUserByEmail(body.email, {
          redirectTo: `${process.env.APP_URL}/auth/callback`,
          data: { display_name: body.display_name },
        });
        if (error || !data.user)
          throw new ApiError(
            422,
            'Convite não enviado. Verifique se o usuário já existe e as configurações de e-mail do Supabase.',
          );
        const { error: insertError } = await a.db.from('memberships').insert({
          tenant_id: a.tenantId,
          user_id: data.user.id,
          role: body.role,
          display_name: body.display_name,
          professional_registration: body.professional_registration || null,
        });
        dbError(insertError);
        return json({ invited: true }, 201);
      }
    }
    if (resource === 'keys') {
      requireAdmin(a);
      if (request.method === 'GET') {
        const { data, error } = await a.db
          .from('api_keys')
          .select('id,name,prefix,scopes,created_at,expires_at,revoked_at')
          .eq('tenant_id', a.tenantId)
          .order('created_at', { ascending: false });
        dbError(error);
        return json({ keys: data });
      }
      if (request.method === 'POST') {
        const body = z
          .object({
            name: z.string().trim().min(2).max(80),
            scopes: z.array(z.enum(['cases:read', 'cases:write'])).min(1),
          })
          .strict()
          .parse(await readJson(request));
        const token = 'aiv_' + randomBytes(32).toString('hex');
        await audit(a, 'api_key.created');
        const { data, error } = await a.db
          .from('api_keys')
          .insert({
            tenant_id: a.tenantId,
            name: body.name,
            key_hash: createHash('sha256').update(token).digest('hex'),
            prefix: token.slice(0, 12),
            scopes: body.scopes,
            created_by: a.userId,
          })
          .select('id,prefix,expires_at')
          .single();
        dbError(error);
        return json({ ...data, token }, 201);
      }
      if (id && request.method === 'DELETE') {
        const { data, error } = await a.db
          .from('api_keys')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', id)
          .eq('tenant_id', a.tenantId)
          .is('revoked_at', null)
          .select('id')
          .maybeSingle();
        dbError(error);
        if (!data) throw new ApiError(404, 'Chave não encontrada.');
        await audit(a, 'api_key.revoked', null, { key_id: id });
        return json({ revoked: true });
      }
    }
    if (resource === 'cases') {
      if (!id && request.method === 'GET') {
        const url = new URL(request.url);
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(1000000)
          .parse(url.searchParams.get('offset') || 0);
        let query = a.db
          .from('cases')
          .select('*,exams(id,name,mime_type,size,created_at,metadata)', { count: 'exact' })
          .eq('tenant_id', a.tenantId)
          .order('created_at', { ascending: false })
          .range(offset, offset + 49);
        const status = url.searchParams.get('status');
        if (status)
          query = query.eq(
            'status',
            z.enum(['pending', 'review', 'approved', 'rejected']).parse(status),
          );
        const { data, error, count } = await query;
        dbError(error);
        await audit(a, 'cases.viewed');
        return json({
          cases: (data || []).map((c) => exposeCase(c, !!a.apiKeyId)),
          total: count,
          offset,
          page_size: 50,
        });
      }
      if (!id && request.method === 'POST') {
        const body = caseSchema.parse(await readJson(request));
        await audit(a, 'case.create_requested');
        const { data, error } = await a.db
          .from('cases')
          .insert({ ...body, tenant_id: a.tenantId })
          .select()
          .single();
        dbError(error);
        await audit(a, 'case.created', data.id);
        return json(exposeCase(data, !!a.apiKeyId), 201);
      }
      if (!id) throw new ApiError(404, 'Rota não encontrada.');
      const c = await getCase(a, id);
      if (!action && request.method === 'GET') {
        await audit(a, 'case.viewed', id);
        return json(exposeCase(c, !!a.apiKeyId));
      }
      if (action === 'uploads') {
        if (request.method === 'POST') {
          const input = await readJson(request);
          if (
            typeof input === 'object' &&
            input !== null &&
            'name' in input &&
            'mime_type' in input
          )
            input.mime_type = normalizeExamMime(String(input.name), String(input.mime_type));
          return json(await reserveExamUpload(a, id, input), 201);
        }
        const body = z
          .object({ upload_id: z.uuid() })
          .strict()
          .parse(await readJson(request));
        if (request.method === 'PATCH')
          return json(await finishExamUpload(a, id, body.upload_id), 200);
        if (request.method === 'DELETE') {
          await cancelExamUpload(a, id, body.upload_id);
          return json({ cancelled: true });
        }
      }
      if (action === 'dicom' && request.method === 'GET') {
        const { data: allowed, error: rateError } = await a.db.rpc('consume_rate_limit', {
          p_key: `dicom:${a.tenantId}`,
          p_limit: 120,
          p_window: 60,
        });
        dbError(rateError);
        if (!allowed)
          throw new ApiError(429, 'Limite de visualizações DICOM atingido. Aguarde um minuto.');
        const url = new URL(request.url);
        const examId = z.uuid().parse(url.searchParams.get('exam_id'));
        const frame = z.coerce
            .number()
            .int()
            .min(0)
            .max(63)
            .parse(url.searchParams.get('frame') || 0),
          window = z.coerce
            .number()
            .int()
            .min(0)
            .max(2)
            .parse(url.searchParams.get('window') || 0);
        const exam = c.exams?.find((e) => e.id === examId && e.mime_type === DICOM_MIME);
        if (!exam) throw new ApiError(404, 'DICOM não encontrado neste caso.');
        await audit(a, 'exam.dicom_frame_viewed', id, { exam_id: examId, frame, window });
        const { data, error } = await a.db.storage
          .from('clinical-files')
          .download(exam.storage_path);
        dbError(error);
        if (!data) throw new ApiError(503, 'Não foi possível ler o DICOM.');
        const rendered = await processDicom(new Uint8Array(await data.arrayBuffer()), {
          frame,
          window,
        });
        return new Response(new Uint8Array(rendered.images[0].png), {
          headers: { ...noStore, 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      if (action === 'upload' && request.method === 'POST') {
        if (c.status !== 'pending' || ('analysis_started_at' in c && c.analysis_started_at))
          throw new ApiError(409, 'Exames só podem ser adicionados antes da análise.');
        if ((c.exams?.length || 0) >= MAX_EXAMS)
          throw new ApiError(422, 'Limite de 64 exames por caso.');
        const length = Number(request.headers.get('content-length') || 0);
        if (length > 4.4 * 1024 * 1024) throw new ApiError(413, 'Arquivo muito grande.');
        const uploadBytes = await boundedBody(request, Math.floor(4.4 * 1024 * 1024));
        const form = await new Response(uploadBytes, {
          headers: { 'content-type': request.headers.get('content-type') || '' },
        }).formData();
        const file = form.get('file');
        if (!(file instanceof File)) throw new ApiError(400, 'Envie um arquivo no campo file.');
        const body = uploadSchema.parse({
          name: file.name,
          mime_type: normalizeExamMime(file.name, file.type),
          size: file.size,
        });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const metadata = await validateExamContent(bytes, body.mime_type);
        const examId = randomUUID(),
          storagePath = `${a.tenantId}/${id}/exams/${examId}`;
        await audit(a, 'exam.upload_requested', id, { exam_id: examId });
        const { error: uploadError } = await a.db.storage
          .from('clinical-files')
          .upload(storagePath, bytes, { contentType: body.mime_type, upsert: false });
        dbError(uploadError);
        const { error: insertError } = await a.db.from('exams').insert({
          ...body,
          id: examId,
          tenant_id: a.tenantId,
          case_id: id,
          storage_path: storagePath,
          metadata,
        });
        if (insertError) {
          await a.db.storage.from('clinical-files').remove([storagePath]);
          dbError(insertError);
        }
        return json({ id: examId, ...body, metadata }, 201);
      }
      if (action === 'analyze' && request.method === 'POST') {
        z.object({ consent: z.literal(true) })
          .strict()
          .parse(await readJson(request));
        if (c.status !== 'pending')
          throw new ApiError(409, 'Este caso já foi analisado ou encerrado.');
        const { data: budget, error: budgetError } = await a.db.rpc('consume_rate_limit', {
          p_key: `analysis:${a.tenantId}`,
          p_limit: 20,
          p_window: 3600,
        });
        dbError(budgetError);
        if (!budget)
          throw new ApiError(429, 'Limite de 20 análises por hora atingido para este cliente.');
        const analysisToken = randomUUID();
        const { data: locked, error: lockError } = await a.db.rpc('start_case_analysis', {
          p_tenant: a.tenantId,
          p_case: id,
          p_token: analysisToken,
        });
        dbError(lockError);
        if (!locked)
          throw new ApiError(
            409,
            'Aguarde os envios ou a análise em andamento antes de analisar este caso.',
          );
        try {
          await audit(a, 'analysis.started', id);
          const lockedCase = await getCase(a, id);
          const result = await analyzeWithGrok(lockedCase, lockedCase.exams || [], a.db);
          const { data, error } = await a.db
            .from('cases')
            .update({
              report: result.report,
              model: result.model,
              analyzed_at: new Date().toISOString(),
              status: 'review',
              analysis_started_at: null,
              analysis_token: null,
            })
            .eq('id', id)
            .eq('tenant_id', a.tenantId)
            .eq('revision', c.revision)
            .eq('analysis_token', analysisToken)
            .eq('status', 'pending')
            .select()
            .maybeSingle();
          dbError(error);
          if (!data) throw new ApiError(409, 'O caso foi alterado durante a análise.');
          await audit(a, 'analysis.completed', id, {
            model: result.model,
            usage: result.usage,
            dicom: result.dicomExtractions,
            image_count: result.imageCount,
          });
          return json(exposeCase(data, !!a.apiKeyId));
        } finally {
          await a.db
            .from('cases')
            .update({ analysis_started_at: null, analysis_token: null })
            .eq('id', id)
            .eq('tenant_id', a.tenantId)
            .eq('analysis_token', analysisToken)
            .eq('status', 'pending');
        }
      }
      if (action === 'report' && request.method === 'PATCH') {
        requirePhysician(a);
        if (c.status !== 'review')
          throw new ApiError(409, 'Somente rascunhos em revisão podem ser editados.');
        const body = z
          .object({ revision: z.number().int().positive(), report: reportSchema })
          .strict()
          .parse(await readJson(request));
        await audit(a, 'report.edit_requested', id, { revision: body.revision });
        const { data, error } = await a.db
          .from('cases')
          .update({ report: body.report, last_edited_by: a.userId })
          .eq('id', id)
          .eq('tenant_id', a.tenantId)
          .eq('revision', body.revision)
          .eq('status', 'review')
          .select()
          .maybeSingle();
        dbError(error);
        if (!data)
          throw new ApiError(409, 'Outra pessoa alterou o relatório. Atualize antes de salvar.');
        return json(exposeCase(data, !!a.apiKeyId));
      }
      if (action === 'reject' && request.method === 'POST') {
        requirePhysician(a);
        const body = z
          .object({
            revision: z.number().int().positive(),
            reason: z.string().trim().min(10).max(1000),
          })
          .strict()
          .parse(await readJson(request));
        if (c.status !== 'review')
          throw new ApiError(409, 'Somente relatórios em revisão podem ser recusados.');
        await audit(a, 'report.rejection_requested', id, { reason: body.reason });
        const { data, error } = await a.db
          .from('cases')
          .update({ status: 'rejected' })
          .eq('id', id)
          .eq('tenant_id', a.tenantId)
          .eq('revision', body.revision)
          .eq('status', 'review')
          .select()
          .maybeSingle();
        dbError(error);
        if (!data) throw new ApiError(409, 'O relatório foi alterado. Atualize a página.');
        return json(exposeCase(data, !!a.apiKeyId));
      }
      if (action === 'approve' && request.method === 'POST') {
        requirePhysician(a);
        const body = z
          .object({ revision: z.number().int().positive(), confirmed: z.literal(true) })
          .strict()
          .parse(await readJson(request));
        if (c.status !== 'review' || c.revision !== body.revision)
          throw new ApiError(409, 'A versão do relatório mudou ou não está em revisão.');
        const final = {
          ...c,
          revision: c.revision + 1,
          approved_at: new Date().toISOString(),
          approver_name: a.membership!.display_name,
          approver_registration: a.membership!.professional_registration,
        };
        const pdf = await generateServerPdf(final, true),
          hash = createHash('sha256').update(pdf).digest('hex');
        const storagePath = `${a.tenantId}/${id}/reports/${randomUUID()}.pdf`;
        const { error: uploadError } = await a.db.storage
          .from('clinical-files')
          .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
        dbError(uploadError);
        const { data, error } = await a.db.rpc('approve_case', {
          p_tenant: a.tenantId,
          p_case: id,
          p_actor: a.userId,
          p_revision: body.revision,
          p_path: storagePath,
          p_hash: hash,
        });
        if (error) {
          await a.db.storage.from('clinical-files').remove([storagePath]);
          throw new ApiError(
            409,
            'A aprovação não foi concluída. Atualize a versão e tente novamente.',
          );
        }
        return json(exposeCase(data, !!a.apiKeyId));
      }
      if (action === 'pdf' && request.method === 'GET') {
        if (!c.report) throw new ApiError(422, 'Este caso ainda não tem relatório.');
        if (a.apiKeyId && c.status !== 'approved')
          throw new ApiError(403, 'A API só disponibiliza PDFs aprovados pelo médico.');
        await audit(a, 'report.pdf_downloaded', id, { status: c.status, revision: c.revision });
        let bytes: Uint8Array;
        if (c.status === 'approved' && c.pdf_path) {
          const { data, error } = await a.db.storage.from('clinical-files').download(c.pdf_path);
          dbError(error);
          bytes = Buffer.from(await data!.arrayBuffer());
          if (createHash('sha256').update(bytes).digest('hex') !== c.pdf_sha256)
            throw new ApiError(502, 'Falha na verificação de integridade do PDF.');
        } else bytes = await generateServerPdf(c, false);
        return new Response(new Uint8Array(bytes), {
          headers: {
            ...noStore,
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="aivis-${id}.pdf"`,
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      if (action === 'history' && request.method === 'GET') {
        if (a.apiKeyId)
          throw new ApiError(403, 'O histórico de rascunhos está disponível apenas na plataforma.');
        await audit(a, 'report.history_viewed', id);
        const { data, error } = await a.db
          .from('report_versions')
          .select('revision,report,status,created_at,actor_id')
          .eq('case_id', id)
          .eq('tenant_id', a.tenantId)
          .order('revision', { ascending: false });
        dbError(error);
        return json({ versions: data });
      }
      if (action === 'exams' && request.method === 'GET') {
        const examId = new URL(request.url).searchParams.get('exam_id');
        const exam = c.exams?.find((e) => e.id === examId);
        if (!exam) throw new ApiError(404, 'Exame não encontrado.');
        await audit(a, 'exam.viewed', id, { exam_id: exam.id });
        if (exam.mime_type === DICOM_MIME) {
          const { data: signed, error } = await a.db.storage
            .from('clinical-files')
            .createSignedUrl(exam.storage_path, 60, { download: exam.name });
          dbError(error);
          if (!signed) throw new ApiError(503, 'Não foi possível autorizar o download.');
          if (new URL(request.url).searchParams.get('download_url') === 'true')
            return json({ url: signed.signedUrl, expires_in: 60 });
          return new Response(null, {
            status: 307,
            headers: { ...noStore, Location: signed.signedUrl },
          });
        }
        const { data, error } = await a.db.storage
          .from('clinical-files')
          .download(exam.storage_path);
        dbError(error);
        return new Response(data, {
          headers: {
            ...noStore,
            'Content-Type': exam.mime_type,
            'Content-Disposition': 'attachment',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'",
          },
        });
      }
    }
    throw new ApiError(404, 'Rota não encontrada.');
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        {
          error: 'Dados inválidos.',
          details: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
        422,
      );
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    if (error instanceof PdfContentError) return json({ error: error.message }, 422);
    if (error instanceof SyntaxError) return json({ error: 'Corpo JSON inválido.' }, 400);
    if (error instanceof Error && error.name === 'TimeoutError')
      return json({ error: 'O provedor demorou para responder. O caso foi preservado.' }, 504);
    console.error('API operation failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return json({ error: 'Falha inesperada. Atualize o caso antes de repetir a operação.' }, 500);
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
