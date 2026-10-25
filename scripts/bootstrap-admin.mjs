import { createClient } from '@supabase/supabase-js';
const email = process.env.ADMIN_EMAIL || 'pedronovikovborges@gmail.com';
const name = process.env.CLINIC_NAME || 'Aivis Clínica';
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Configure as variáveis do Supabase no ambiente do processo.');
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
// This script never sends email or creates a password. Create the auth user in
// the Supabase dashboard first; the script only binds the existing identity.
let user;
let page = 1;
while (!user) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw new Error('Não foi possível consultar os usuários do Supabase.');
  user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (data.users.length < 100) break;
  page++;
}
if (!user)
  throw new Error(
    'Crie o administrador em Supabase > Authentication > Users primeiro. Nenhum e-mail foi enviado por este script.',
  );
const { data: existing, error: existingError } = await db
  .from('memberships')
  .select('tenant_id')
  .eq('user_id', user.id)
  .eq('role', 'admin')
  .limit(1);
if (existingError) throw new Error('Execute a migração do banco antes do bootstrap.');
if (existing.length) {
  console.log('Administrador já vinculado; nenhuma alteração necessária.');
  process.exit(0);
}
const { data: tenant, error } = await db.from('tenants').insert({ name }).select('id').single();
if (error) throw new Error('Falha ao criar a organização.');
const { error: bindError } = await db.from('memberships').insert({
  tenant_id: tenant.id,
  user_id: user.id,
  display_name: 'Pedro Borges',
  role: 'admin',
  professional_registration: process.env.ADMIN_PROFESSIONAL_REGISTRATION || null,
});
if (bindError) {
  await db.from('tenants').delete().eq('id', tenant.id);
  throw new Error('Falha ao vincular o administrador.');
}
console.log(
  'Administrador e organização vinculados. Cadastre o CRM real de cada médico antes de permitir a revisão clínica.',
);
