import { createHash, timingSafeEqual } from 'node:crypto';
import { adminDb, isConfigured, sessionDb } from './supabase';
import type { Membership } from './types';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Access = {
  db: ReturnType<typeof adminDb>;
  tenantId: string;
  userId: string | null;
  membership: Membership | null;
  apiKeyId: string | null;
  scopes: string[];
};
export function checkOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('authorization')?.startsWith('Bearer ')) return;
  const origin = request.headers.get('origin');
  const expected =
    process.env.APP_URL ||
    (process.env.NODE_ENV === 'development' ? new URL(request.url).origin : null);
  if (!origin || !expected || origin !== expected)
    throw new ApiError(403, 'Origem da requisição não autorizada.');
}
export async function authorize(request: Request, scope = 'cases:read'): Promise<Access> {
  if (!isConfigured()) throw new ApiError(503, 'Conecte o Supabase para usar o ambiente real.');
  checkOrigin(request);
  const db = adminDb();
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (token) {
    if (!/^aiv_[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'Chave de API inválida.');
    const hash = createHash('sha256').update(token).digest('hex');
    const { data: key, error } = await db
      .from('api_keys')
      .select('*')
      .eq('key_hash', hash)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) throw new ApiError(503, 'Não foi possível validar a chave.');
    if (!key || !timingSafeEqual(Buffer.from(hash), Buffer.from(key.key_hash)))
      throw new ApiError(401, 'Chave inválida, expirada ou revogada.');
    if (!key.scopes.includes(scope))
      throw new ApiError(403, 'Escopo insuficiente para esta operação.');
    const { data: allowed, error: limitError } = await db.rpc('consume_rate_limit', {
      p_key: `api:${key.id}`,
      p_limit: 60,
      p_window: 60,
    });
    if (limitError) throw new ApiError(503, 'Limitador temporariamente indisponível.');
    if (!allowed) throw new ApiError(429, 'Limite de 60 requisições por minuto excedido.');
    return {
      db,
      tenantId: key.tenant_id,
      userId: null,
      membership: null,
      apiKeyId: key.id,
      scopes: key.scopes,
    };
  }
  const session = await sessionDb();
  const {
    data: { user },
    error,
  } = await session.auth.getUser();
  if (error || !user) throw new ApiError(401, 'Entre na sua conta para continuar.');
  const { data: members, error: membersError } = await db
    .from('memberships')
    .select('tenant_id,role,display_name,professional_registration,tenants(name)')
    .eq('user_id', user.id);
  if (membersError) throw new ApiError(503, 'Não foi possível consultar os vínculos.');
  const tenantId = request.headers.get('x-tenant-id') || members?.[0]?.tenant_id;
  const membership = members?.find((m) => m.tenant_id === tenantId) as unknown as Membership;
  if (!membership) throw new ApiError(403, 'Sua conta não tem acesso a este cliente.');
  if (scope.endsWith(':write') && membership.role === 'viewer')
    throw new ApiError(403, 'Seu perfil permite apenas consulta.');
  const { data: allowed, error: rateError } = await db.rpc('consume_rate_limit', {
    p_key: `user:${user.id}`,
    p_limit: 120,
    p_window: 60,
  });
  if (rateError) throw new ApiError(503, 'Limitador temporariamente indisponível.');
  if (!allowed) throw new ApiError(429, 'Limite de requisições excedido.');
  return { db, tenantId, userId: user.id, membership, apiKeyId: null, scopes: [] };
}
export function requireAdmin(a: Access) {
  if (a.apiKeyId || a.membership?.role !== 'admin')
    throw new ApiError(403, 'Apenas administradores podem gerenciar a organização.');
}
export function requirePhysician(a: Access) {
  if (
    a.apiKeyId ||
    !a.membership ||
    !['admin', 'physician'].includes(a.membership.role) ||
    !a.membership.professional_registration?.trim()
  )
    throw new ApiError(
      403,
      'A revisão exige uma sessão médica com registro profissional cadastrado.',
    );
}
export async function audit(
  a: Access,
  action: string,
  caseId: string | null = null,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await a.db.from('audit_events').insert({
    tenant_id: a.tenantId,
    actor_id: a.userId,
    api_key_id: a.apiKeyId,
    action,
    case_id: caseId,
    metadata,
  });
  if (error) throw new ApiError(503, 'Não foi possível registrar a auditoria.');
}
