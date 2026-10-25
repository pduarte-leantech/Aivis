-- Run with the Supabase SQL editor or `supabase db push`.
-- gen_random_uuid() is built into PostgreSQL 13+. No extra extension needed.

create table public.tenants (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 160), created_at timestamptz not null default now()
);
create table public.memberships (
 tenant_id uuid not null references public.tenants(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('admin','physician','viewer')), display_name text not null,
 professional_registration text, created_at timestamptz not null default now(), primary key(tenant_id,user_id)
);
create table public.cases (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 patient_name text not null, patient_code text not null, birth_date date, anamnesis text not null,
 status text not null default 'pending' check(status in ('pending','review','approved','rejected')),
 report jsonb, revision integer not null default 1, model text, analysis_started_at timestamptz, analysis_token uuid, analyzed_at timestamptz,
 approved_at timestamptz, approved_by uuid references auth.users(id), approver_name text, approver_registration text,
 pdf_path text, pdf_sha256 text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,id),
 constraint approval_complete check(status <> 'approved' or (approved_at is not null and approved_by is not null and pdf_path is not null and pdf_sha256 is not null and report is not null))
);
create table public.exams (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, case_id uuid not null,
 name text not null, mime_type text not null, size integer not null check(size > 0 and size <= 4194304), storage_path text not null unique,
 created_at timestamptz not null default now(), foreign key(tenant_id,case_id) references public.cases(tenant_id,id)
);
create table public.api_keys (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), name text not null,
 key_hash text not null unique, prefix text not null, scopes text[] not null default '{cases:read,cases:write}',
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '90 days', revoked_at timestamptz,
 check(scopes <@ array['cases:read','cases:write'])
);
create table public.audit_events (
 id bigint generated always as identity primary key, tenant_id uuid not null references public.tenants(id),
 actor_id uuid references auth.users(id), api_key_id uuid references public.api_keys(id), case_id uuid,
 action text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(tenant_id,case_id) references public.cases(tenant_id,id)
);
create table public.report_versions (
 id bigint generated always as identity primary key, tenant_id uuid not null, case_id uuid not null, revision integer not null,
 report jsonb, status text not null, actor_id uuid, created_at timestamptz not null default now(),
 foreign key(tenant_id,case_id) references public.cases(tenant_id,id), unique(case_id,revision)
);
create table public.rate_limits (key text primary key, window_start timestamptz not null, count integer not null);
create index cases_tenant_created on public.cases(tenant_id,created_at desc);
create index exams_tenant_case on public.exams(tenant_id,case_id);
create index audit_tenant_created on public.audit_events(tenant_id,created_at desc);
create index memberships_user on public.memberships(user_id);

-- Browser clients may read their own memberships. Clinical records and storage
-- are only exposed by the server after tenant authorization; no direct grants.
alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.cases enable row level security;
alter table public.exams enable row level security;
alter table public.api_keys enable row level security;
alter table public.audit_events enable row level security;
alter table public.report_versions enable row level security;
alter table public.rate_limits enable row level security;
create policy own_memberships on public.memberships for select to authenticated using(user_id=auth.uid());
create policy own_tenants on public.tenants for select to authenticated using(exists(select 1 from public.memberships m where m.user_id=auth.uid() and m.tenant_id=tenants.id));
revoke all on public.cases,public.exams,public.api_keys,public.audit_events,public.report_versions,public.rate_limits from anon,authenticated;
grant select on public.memberships,public.tenants to authenticated;

create function public.consume_rate_limit(p_key text,p_limit integer,p_window integer) returns boolean
language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
 insert into rate_limits(key,window_start,count) values(p_key,now(),1)
 on conflict(key) do update set
 count=case when rate_limits.window_start < now()-make_interval(secs=>p_window) then 1 else rate_limits.count+1 end,
 window_start=case when rate_limits.window_start < now()-make_interval(secs=>p_window) then now() else rate_limits.window_start end
 returning count into v_count;
 return v_count<=p_limit;
end $$;
revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;

create function public.protect_case() returns trigger language plpgsql set search_path=public as $$
begin
 if old.status='approved' then raise exception 'Approved reports are immutable'; end if;
 if new.tenant_id<>old.tenant_id or new.id<>old.id then raise exception 'Case identity is immutable'; end if;
 if new.report is distinct from old.report or new.status is distinct from old.status then
   insert into report_versions(tenant_id,case_id,revision,report,status,actor_id) values(old.tenant_id,old.id,old.revision,old.report,old.status,old.approved_by);
   new.revision=old.revision+1;
 end if;
 new.updated_at=now();
 return new;
end $$;
create trigger protect_case before update on public.cases for each row execute function public.protect_case();

-- Approval and its audit event commit atomically. Only service_role can call.
create function public.approve_case(p_tenant uuid,p_case uuid,p_actor uuid,p_revision integer,p_path text,p_hash text)
returns public.cases language plpgsql security definer set search_path=public as $$
declare m public.memberships; c public.cases;
begin
 select * into m from memberships where tenant_id=p_tenant and user_id=p_actor;
 if m.user_id is null or m.role not in ('admin','physician') or nullif(trim(m.professional_registration),'') is null then raise exception 'Physician registration required'; end if;
 update cases set status='approved',approved_at=now(),approved_by=p_actor,approver_name=m.display_name,approver_registration=m.professional_registration,pdf_path=p_path,pdf_sha256=p_hash
 where id=p_case and tenant_id=p_tenant and revision=p_revision and status='review' and report is not null and analysis_started_at is null returning * into c;
 if c.id is null then raise exception 'REVISION_CONFLICT'; end if;
 insert into audit_events(tenant_id,actor_id,case_id,action,metadata) values(p_tenant,p_actor,p_case,'report.approved',jsonb_build_object('revision',c.revision,'sha256',p_hash));
 return c;
end $$;
revoke all on function public.approve_case(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.approve_case(uuid,uuid,uuid,integer,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('clinical-files','clinical-files',false,4194304,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
-- No browser storage policies. Signed short-lived URLs only, after authorization.

-- Serialize uploads against analysis and enforce quotas in the database.
create function public.guard_exam() returns trigger language plpgsql set search_path=public as $$
declare c public.cases; n integer; total bigint;
begin
 select * into c from cases where tenant_id=new.tenant_id and id=new.case_id for update;
 if c.status <> 'pending' or c.analysis_started_at is not null then raise exception 'Case is not accepting exams'; end if;
 select count(*),coalesce(sum(size),0) into n,total from exams where case_id=new.case_id;
 if n>=8 or total+new.size>20971520 then raise exception 'Exam quota exceeded'; end if;
 return new;
end $$;
create trigger guard_exam before insert on public.exams for each row execute function public.guard_exam();

create function public.dashboard_stats(p_tenant uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'totals',jsonb_build_object(
 'cases',(select count(*) from cases where tenant_id=p_tenant),
 'exams',(select count(*) from exams where tenant_id=p_tenant),
 'analyzed',(select count(*) from cases where tenant_id=p_tenant and model is not null),
 'review',(select count(*) from cases where tenant_id=p_tenant and status='review'),
 'approved',(select count(*) from cases where tenant_id=p_tenant and status='approved')),
 'months',(select coalesce(jsonb_agg(jsonb_build_object('month',to_char(m,'YYYY-MM'),'exams',
 (select count(*) from exams e join cases c on c.id=e.case_id and c.tenant_id=e.tenant_id where c.tenant_id=p_tenant and date_trunc('month',timezone('America/Sao_Paulo',c.analyzed_at))=m),
 'cases',(select count(*) from cases c where c.tenant_id=p_tenant and date_trunc('month',timezone('America/Sao_Paulo',c.created_at))=m)) order by m),'[]'::jsonb)
 from generate_series(date_trunc('month',timezone('America/Sao_Paulo',now()))-interval '11 months',date_trunc('month',timezone('America/Sao_Paulo',now())),interval '1 month') m)
 )
$$;
revoke all on function public.dashboard_stats(uuid) from public,anon,authenticated;
grant execute on function public.dashboard_stats(uuid) to service_role;

create function public.append_only() returns trigger language plpgsql as $$
begin raise exception 'Append-only record'; end $$;
create trigger audit_append_only before update or delete on public.audit_events for each row execute function public.append_only();
create trigger versions_append_only before update or delete on public.report_versions for each row execute function public.append_only();

grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
