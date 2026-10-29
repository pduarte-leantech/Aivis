begin;
alter table public.exams add column metadata jsonb;
alter table public.exams drop constraint exams_size_check;
alter table public.exams add constraint exams_size_check check(size>0 and size<=case when mime_type='application/dicom' then 52428800 else 4194304 end);
update storage.buckets set file_size_limit=52428800,allowed_mime_types=array['application/dicom','application/pdf','image/jpeg','image/png','image/webp'] where id='clinical-files';

create table public.exam_uploads (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,case_id uuid not null,
 name text not null check(length(name) between 1 and 180),mime_type text not null check(mime_type in ('application/dicom','application/pdf','image/jpeg','image/png','image/webp')),
 size integer not null check(size>0 and size<=case when mime_type='application/dicom' then 52428800 else 4194304 end),
 storage_path text not null unique,status text not null default 'pending' check(status in ('pending','complete','failed')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '15 minutes',
 foreign key(tenant_id,case_id) references public.cases(tenant_id,id)
);
create index exam_uploads_case on public.exam_uploads(tenant_id,case_id,status,expires_at);
alter table public.exam_uploads enable row level security;
revoke all on public.exam_uploads from anon,authenticated;
grant all on public.exam_uploads to service_role;

create or replace function public.guard_exam() returns trigger language plpgsql set search_path=public as $$
declare c public.cases; n bigint; total bigint;
begin
 select * into c from cases where tenant_id=new.tenant_id and id=new.case_id for update;
 if c.id is null or c.status<>'pending' or c.analysis_started_at is not null then raise exception 'Case is not accepting exams'; end if;
 select count(*),coalesce(sum(size),0) into n,total from (
  select size from exams where case_id=new.case_id
  union all select size from exam_uploads where case_id=new.case_id and status='pending' and expires_at>now()
 ) files;
 if n>=64 or total+new.size>268435456 then raise exception 'Exam quota exceeded'; end if;
 return new;
end $$;

create function public.reserve_exam_upload(p_tenant uuid,p_case uuid,p_name text,p_mime text,p_size integer)
returns public.exam_uploads language plpgsql security definer set search_path=public as $$
declare c public.cases; n bigint; total bigint; u public.exam_uploads; upload_id uuid=gen_random_uuid();
begin
 select * into c from cases where id=p_case and tenant_id=p_tenant for update;
 if c.id is null or c.status<>'pending' or c.analysis_started_at is not null then raise exception 'Case is not accepting exams'; end if;
 select count(*),coalesce(sum(size),0) into n,total from (
 select size from exams where tenant_id=p_tenant and case_id=p_case
 union all select size from exam_uploads where tenant_id=p_tenant and case_id=p_case and status='pending' and expires_at>now()
 ) files;
 if n>=64 or total+p_size>268435456 then raise exception 'Exam quota exceeded'; end if;
 insert into exam_uploads(id,tenant_id,case_id,name,mime_type,size,storage_path)
 values(upload_id,p_tenant,p_case,p_name,p_mime,p_size,p_tenant::text||'/'||p_case::text||'/exams/'||upload_id::text) returning * into u;
 return u;
end $$;

create function public.finish_exam_upload(p_tenant uuid,p_case uuid,p_upload uuid,p_metadata jsonb)
returns public.exams language plpgsql security definer set search_path=public as $$
declare u public.exam_uploads; e public.exams;
begin
 -- Always lock the case before reservation rows, matching the analysis lock order.
 perform 1 from cases where id=p_case and tenant_id=p_tenant for update;
 select * into u from exam_uploads where id=p_upload and tenant_id=p_tenant and case_id=p_case for update;
 if u.id is null then raise exception 'Upload not found'; end if;
 if u.status='complete' then select * into e from exams where id=u.id and tenant_id=p_tenant; return e; end if;
 if u.status<>'pending' or u.expires_at<=now() then raise exception 'Upload expired'; end if;
 update exam_uploads set status='complete' where id=u.id;
 insert into exams(id,tenant_id,case_id,name,mime_type,size,storage_path,metadata) values(u.id,u.tenant_id,u.case_id,u.name,u.mime_type,u.size,u.storage_path,p_metadata) returning * into e;
 return e;
end $$;

create function public.start_case_analysis(p_tenant uuid,p_case uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare c public.cases;
begin
 select * into c from cases where id=p_case and tenant_id=p_tenant for update;
 if c.id is null or c.status<>'pending' or (c.analysis_started_at is not null and c.analysis_started_at>now()-interval '3 minutes') then return false; end if;
 if exists(select 1 from exam_uploads where tenant_id=p_tenant and case_id=p_case and status='pending' and expires_at>now()) then return false; end if;
 update cases set analysis_started_at=now(),analysis_token=p_token where id=p_case and tenant_id=p_tenant;
 return true;
end $$;
create function public.cancel_exam_upload(p_tenant uuid,p_case uuid,p_upload uuid) returns text
language plpgsql security definer set search_path=public as $$
declare u public.exam_uploads;
begin
 perform 1 from cases where id=p_case and tenant_id=p_tenant for update;
 select * into u from exam_uploads where id=p_upload and tenant_id=p_tenant and case_id=p_case for update;
 if u.id is null or u.status='complete' then return null; end if;
 update exam_uploads set status='failed' where id=u.id;
 return u.storage_path;
end $$;
revoke all on function public.cancel_exam_upload(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_exam_upload(uuid,uuid,uuid) to service_role;
revoke all on function public.reserve_exam_upload(uuid,uuid,text,text,integer),public.finish_exam_upload(uuid,uuid,uuid,jsonb),public.start_case_analysis(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_exam_upload(uuid,uuid,text,text,integer),public.finish_exam_upload(uuid,uuid,uuid,jsonb),public.start_case_analysis(uuid,uuid,uuid) to service_role;
commit;
