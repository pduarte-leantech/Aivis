import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
const mocks = vi.hoisted(() => ({
  configured: true,
  key: null as Record<string, unknown> | null,
  members: [] as Record<string, unknown>[],
  user: null as { id: string } | null,
  allowed: true,
  filters: [] as [string, unknown][],
  dbError: null as unknown,
}));
vi.mock('../src/lib/supabase', () => ({
  isConfigured: () => mocks.configured,
  sessionDb: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
  }),
  adminDb: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (field: string, value: unknown) => {
          mocks.filters.push([field, value]);
          return chain;
        },
        is: () => chain,
        gt: () => chain,
        maybeSingle: async () => ({ data: mocks.key, error: mocks.dbError }),
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve(
            resolve({ data: table === 'memberships' ? mocks.members : [], error: mocks.dbError }),
          ),
      };
      return chain;
    },
    rpc: async () => ({ data: mocks.allowed, error: mocks.dbError }),
  }),
}));
import { authorize } from '../src/lib/auth';
const key = 'aiv_' + 'a'.repeat(64);
const hash = createHash('sha256').update(key).digest('hex');
function req(headers: Record<string, string> = {}, method = 'GET') {
  return new Request('https://aivis.invalid/api/v1/cases', { method, headers });
}
beforeEach(() => {
  mocks.configured = true;
  mocks.key = null;
  mocks.members = [];
  mocks.user = null;
  mocks.allowed = true;
  mocks.filters = [];
  mocks.dbError = null;
});
describe('Server authorization with injected credentials', () => {
  it('does not mistake an absent configuration for a working API', async () => {
    mocks.configured = false;
    await expect(authorize(req())).rejects.toMatchObject({ status: 503 });
  });
  it('rejects anonymous requests and malformed API keys', async () => {
    await expect(authorize(req())).rejects.toMatchObject({ status: 401 });
    await expect(authorize(req({ authorization: 'Bearer invalid' }))).rejects.toMatchObject({
      status: 401,
    });
  });
  it('rejects expired or revoked keys not returned by the active-key query', async () => {
    await expect(authorize(req({ authorization: `Bearer ${key}` }))).rejects.toMatchObject({
      status: 401,
    });
    expect(mocks.filters).toContainEqual(['key_hash', hash]);
  });
  it('derives tenant exclusively from the key and ignores spoofed tenant headers', async () => {
    mocks.key = { id: 'key-id', tenant_id: 'tenant-a', key_hash: hash, scopes: ['cases:read'] };
    const access = await authorize(
      req({ authorization: `Bearer ${key}`, 'x-tenant-id': 'tenant-b' }),
    );
    expect(access.tenantId).toBe('tenant-a');
    expect(access.membership).toBeNull();
    expect(access.userId).toBeNull();
  });
  it('rejects insufficient key scopes before data access', async () => {
    mocks.key = { id: 'key-id', tenant_id: 'tenant-a', key_hash: hash, scopes: ['cases:read'] };
    await expect(
      authorize(req({ authorization: `Bearer ${key}` }, 'POST'), 'cases:write'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('rejects nonmembers and forged session tenant selection', async () => {
    mocks.user = { id: 'doctor-a' };
    mocks.members = [
      { tenant_id: 'tenant-a', role: 'physician', professional_registration: 'CRM-SP 1' },
    ];
    await expect(authorize(req({ 'x-tenant-id': 'tenant-b' }))).rejects.toMatchObject({
      status: 403,
    });
    const access = await authorize(req({ 'x-tenant-id': 'tenant-a' }));
    expect(access.tenantId).toBe('tenant-a');
    expect(mocks.filters).toContainEqual(['user_id', 'doctor-a']);
  });
  it('enforces read-only roles and shared rate limits', async () => {
    mocks.user = { id: 'viewer-a' };
    mocks.members = [{ tenant_id: 'tenant-a', role: 'viewer' }];
    await expect(authorize(req(), 'cases:write')).rejects.toMatchObject({ status: 403 });
    mocks.allowed = false;
    await expect(authorize(req())).rejects.toMatchObject({ status: 429 });
  });
  it('fails closed when the authorization database is unavailable', async () => {
    mocks.user = { id: 'doctor-a' };
    mocks.dbError = { message: 'private database error should never leak' };
    await expect(authorize(req())).rejects.toMatchObject({ status: 503 });
  });
});
