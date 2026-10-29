import type { Access } from './auth';
import { ApiError, audit } from './auth';
import { processDicom } from './dicom';
import { DICOM_MIME, normalizeExamMime } from './upload-policy';
import { isFileSignature, uploadSchema } from './validation';
import type { Exam } from './types';
export async function reserveExamUpload(a: Access, caseId: string, input: unknown) {
  const data = uploadSchema.parse(input);
  const { data: upload, error } = await a.db.rpc('reserve_exam_upload', {
    p_tenant: a.tenantId,
    p_case: caseId,
    p_name: data.name,
    p_mime: data.mime_type,
    p_size: data.size,
  });
  if (error || !upload)
    throw new ApiError(
      409,
      'O caso não aceita este envio ou excedeu a cota de 64 arquivos / 256 MB.',
    );
  const { data: signed, error: signError } = await a.db.storage
    .from('clinical-files')
    .createSignedUploadUrl(upload.storage_path, { upsert: false });
  if (signError || !signed) {
    await a.db.from('exam_uploads').delete().eq('id', upload.id).eq('tenant_id', a.tenantId);
    throw new ApiError(503, 'Não foi possível autorizar o envio privado.');
  }
  await audit(a, 'exam.upload_authorized', caseId, { upload_id: upload.id });
  return {
    upload_id: upload.id,
    signed_url: signed.signedUrl,
    expires_at: upload.expires_at,
    mime_type: data.mime_type,
  };
}
export async function cancelExamUpload(a: Access, caseId: string, id: string) {
  const { data: path, error } = await a.db.rpc('cancel_exam_upload', {
    p_tenant: a.tenantId,
    p_case: caseId,
    p_upload: id,
  });
  if (error) throw new ApiError(503, 'Não foi possível cancelar o envio.');
  if (!path) throw new ApiError(409, 'Envio não encontrado ou já concluído.');
  const { error: removeError } = await a.db.storage.from('clinical-files').remove([path]);
  if (removeError)
    throw new ApiError(
      503,
      'O envio foi cancelado; a remoção do arquivo será repetida pela limpeza de envios pendentes.',
    );
}
export async function validateExamContent(bytes: Uint8Array, mime: string) {
  if (!isFileSignature(bytes, mime))
    throw new ApiError(422, 'Conteúdo do arquivo incompatível com o formato.');
  return mime === DICOM_MIME ? (await processDicom(bytes, { mode: 'inspect' })).metadata : null;
}
export async function finishExamUpload(a: Access, caseId: string, id: string): Promise<Exam> {
  const { data: upload, error } = await a.db
    .from('exam_uploads')
    .select('*')
    .eq('tenant_id', a.tenantId)
    .eq('case_id', caseId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ApiError(503, 'Não foi possível consultar o envio.');
  if (!upload) throw new ApiError(404, 'Envio não encontrado.');
  if (upload.status === 'complete') {
    const { data: exam, error: readError } = await a.db
      .from('exams')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', a.tenantId)
      .eq('case_id', caseId)
      .single();
    if (readError) throw new ApiError(503, 'Não foi possível recuperar o exame confirmado.');
    return { ...exam, storage_path: '' };
  }
  if (upload.status !== 'pending' || new Date(upload.expires_at).getTime() <= Date.now())
    throw new ApiError(409, 'Envio cancelado ou expirado. Inicie um novo envio.');
  const { data: info, error: infoError } = await a.db.storage
    .from('clinical-files')
    .info(upload.storage_path);
  if (infoError || !info)
    throw new ApiError(
      409,
      'O arquivo ainda não chegou ao armazenamento. Conclua o envio antes de confirmar.',
    );
  try {
    // Validate object size/type before downloading large data into the function.
    if (
      info.size !== upload.size ||
      normalizeExamMime(upload.name, info.contentType || '') !== upload.mime_type
    )
      throw new ApiError(
        422,
        'O arquivo armazenado não corresponde ao tamanho/formato autorizado.',
      );
    const { data: blob, error: downloadError } = await a.db.storage
      .from('clinical-files')
      .download(upload.storage_path);
    if (downloadError || !blob)
      throw new ApiError(503, 'Não foi possível validar o arquivo recebido.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length !== upload.size)
      throw new ApiError(422, 'O tamanho recebido não corresponde ao envio.');
    const metadata = await validateExamContent(bytes, upload.mime_type);
    const { data: exam, error: finishError } = await a.db.rpc('finish_exam_upload', {
      p_tenant: a.tenantId,
      p_case: caseId,
      p_upload: id,
      p_metadata: metadata,
    });
    if (finishError)
      throw new ApiError(409, 'O caso foi alterado, o envio expirou ou a cota foi excedida.');
    await audit(a, 'exam.upload_completed', caseId, { exam_id: id, format: upload.mime_type });
    return { ...exam, storage_path: '' };
  } catch (error) {
    // A transient read failure remains retryable. Invalid files are discarded privately.
    if (error instanceof ApiError && error.status === 422) await cancelExamUpload(a, caseId, id);
    throw error;
  }
}
