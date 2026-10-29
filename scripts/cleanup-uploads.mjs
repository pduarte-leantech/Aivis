import { createClient } from '@supabase/supabase-js';
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Configure o Supabase no ambiente do processo.');
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
// Signed upload capabilities expire after 2 hours. Keep tombstones for 3 hours
// so a late client cannot recreate an object after its reservation is deleted.
const before = new Date(Date.now() - 3 * 3600000).toISOString();
const { data: uploads, error } = await db
  .from('exam_uploads')
  .select('id,tenant_id,case_id')
  .in('status', ['pending', 'failed'])
  .lt('created_at', before)
  .limit(100);
if (error) throw new Error('Não foi possível consultar envios expirados.');
let count = 0;
for (const upload of uploads) {
  const { data: path, error: cancelError } = await db.rpc('cancel_exam_upload', {
    p_tenant: upload.tenant_id,
    p_case: upload.case_id,
    p_upload: upload.id,
  });
  if (cancelError) throw new Error('Não foi possível cancelar um envio.');
  if (!path) continue;
  const { error: removeError } = await db.storage.from('clinical-files').remove([path]);
  if (removeError) throw new Error('Não foi possível remover um objeto expirado.');
  const { error: deleteError } = await db
    .from('exam_uploads')
    .delete()
    .eq('id', upload.id)
    .eq('status', 'failed');
  if (deleteError) throw new Error('Não foi possível limpar a reserva expirada.');
  count++;
}
console.log(`Reservas expiradas removidas: ${count}. Nenhum exame confirmado foi alterado.`);
