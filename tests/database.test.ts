import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const t1 = '11111111-1111-4111-8111-111111111111',
  t2 = '22222222-2222-4222-8222-222222222222',
  u1 = '33333333-3333-4333-8333-333333333333',
  u2 = '44444444-4444-4444-8444-444444444444',
  c1 = '55555555-5555-4555-8555-555555555555';
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  const migration = await readFile('supabase/migrations/202610250001_initial.sql', 'utf8');
  await db.exec(migration);
  await db.query('insert into auth.users values($1),($2)', [u1, u2]);
  await db.query('insert into tenants(id,name) values($1,$2),($3,$4)', [
    t1,
    'Clínica A',
    t2,
    'Clínica B',
  ]);
  await db.query(
    "insert into memberships(tenant_id,user_id,role,display_name,professional_registration) values($1,$2,'physician','Médico Teste','CRM-SP 123'),($3,$4,'viewer','Consulta Teste',null)",
    [t1, u1, t2, u2],
  );
  await db.query(
    "insert into cases(id,tenant_id,patient_name,patient_code,anamnesis) values($1,$2,'Teste','T1','Histórico fictício')",
    [c1, t1],
  );
});
afterAll(async () => {
  await db?.close();
});
describe('PostgreSQL migration and tenant security', () => {
  it('creates all protected clinical tables with RLS enabled', async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname,relrowsecurity from pg_class where relname in ('tenants','memberships','cases','exams','api_keys','audit_events','report_versions','rate_limits')",
    );
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
  it('denies browser access to clinical tables even for an authenticated user', async () => {
    await db.exec('set role authenticated');
    try {
      await expect(db.query('select * from cases')).rejects.toThrow('permission denied');
      await expect(db.query('select * from api_keys')).rejects.toThrow('permission denied');
      await expect(
        db.query("select approve_case($1,$2,$3,1,'path','hash')", [t1, c1, u1]),
      ).rejects.toThrow('permission denied');
    } finally {
      await db.exec('reset role');
    }
  });
  it('membership RLS does not reveal another tenant membership', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [u1]);
    await db.exec('set role authenticated');
    try {
      const { rows } = await db.query<{ tenant_id: string }>('select tenant_id from memberships');
      expect(rows).toEqual([{ tenant_id: t1 }]);
      const tenants = await db.query<{ id: string }>('select id from tenants');
      expect(tenants.rows).toEqual([{ id: t1 }]);
    } finally {
      await db.exec('reset role');
    }
  });
  it('enforces bounded rate limits in shared PostgreSQL state', async () => {
    for (let i = 0; i < 2; i++) {
      const { rows } = await db.query<{ allowed: boolean }>(
        "select consume_rate_limit('test',2,60) as allowed",
      );
      expect(rows[0].allowed).toBe(true);
    }
    const { rows } = await db.query<{ allowed: boolean }>(
      "select consume_rate_limit('test',2,60) as allowed",
    );
    expect(rows[0].allowed).toBe(false);
  });
  it('refuses cross-tenant exam associations and uploads during analysis', async () => {
    await expect(
      db.query(
        "insert into exams(tenant_id,case_id,name,mime_type,size,storage_path) values($1,$2,'x.pdf','application/pdf',100,'bad')",
        [t2, c1],
      ),
    ).rejects.toThrow();
    await db.query('update cases set analysis_started_at=now() where id=$1', [c1]);
    await expect(
      db.query(
        "insert into exams(tenant_id,case_id,name,mime_type,size,storage_path) values($1,$2,'x.pdf','application/pdf',100,'locked')",
        [t1, c1],
      ),
    ).rejects.toThrow('not accepting');
    await db.query('update cases set analysis_started_at=null where id=$1', [c1]);
  });
  it('refuses approval by a doctor of a different tenant and a viewer', async () => {
    await expect(
      db.query("select approve_case($1,$2,$3,1,'path','hash')", [t1, c1, u2]),
    ).rejects.toThrow('Physician');
    await expect(
      db.query("select approve_case($1,$2,$3,1,'path','hash')", [t2, c1, u2]),
    ).rejects.toThrow('Physician');
  });
  it('versions changes and only approves the current reviewed report', async () => {
    await db.query(
      "update cases set report=$1,status='review',model='test',analyzed_at=now() where id=$2",
      [JSON.stringify({ summary: 'Test report' }), c1],
    );
    const { rows } = await db.query<{ revision: number }>(
      'select revision from cases where id=$1',
      [c1],
    );
    expect(rows[0].revision).toBe(2);
    await expect(
      db.query("select approve_case($1,$2,$3,1,'path','hash')", [t1, c1, u1]),
    ).rejects.toThrow('REVISION_CONFLICT');
    await db.query("select approve_case($1,$2,$3,2,'path','hash')", [t1, c1, u1]);
    const result = await db.query<{ status: string; revision: number; approved_by: string }>(
      'select status,revision,approved_by from cases where id=$1',
      [c1],
    );
    expect(result.rows[0]).toEqual({ status: 'approved', revision: 3, approved_by: u1 });
    const events = await db.query<{ action: string }>(
      'select action from audit_events where case_id=$1',
      [c1],
    );
    expect(events.rows).toEqual([{ action: 'report.approved' }]);
  });
  it('preserves approved records and append-only history', async () => {
    await expect(db.query("update cases set report='{}' where id=$1", [c1])).rejects.toThrow(
      'immutable',
    );
    await expect(db.query('delete from audit_events')).rejects.toThrow('Append-only');
    await expect(db.query('delete from report_versions')).rejects.toThrow('Append-only');
    const { rows } = await db.query(
      'select revision from report_versions where case_id=$1 order by revision',
      [c1],
    );
    expect(rows).toEqual([{ revision: 1 }, { revision: 2 }]);
  });
  it('aggregates exact per-tenant counts without leaking another tenant', async () => {
    const result = await db.query<{
      stats: { totals: { cases: number; approved: number }; months: unknown[] };
    }>('select dashboard_stats($1) as stats', [t1]);
    expect(result.rows[0].stats.totals.cases).toBe(1);
    expect(result.rows[0].stats.totals.approved).toBe(1);
    expect(result.rows[0].stats.months).toHaveLength(12);
    const other = await db.query<{ stats: { totals: { cases: number } } }>(
      'select dashboard_stats($1) as stats',
      [t2],
    );
    expect(other.rows[0].stats.totals.cases).toBe(0);
  });
  it('keeps the storage bucket private with a platform-compatible 4 MB limit', async () => {
    const { rows } = await db.query('select public,file_size_limit from storage.buckets');
    expect(rows).toEqual([{ public: false, file_size_limit: 4194304 }]);
  });
});
