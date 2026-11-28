-- Contact encryption, step 1 of 2: make room for encrypted values.
--
-- Run this in the Supabase SQL editor BEFORE deploying the new app version.
-- It changes nothing that is already stored: the old plaintext columns stay
-- readable, so the app that is live right now keeps working.
--
-- After this, deploy the app, run `node scripts/encrypt-contacts.mjs`, and then
-- run contact-encryption-2-finalize.sql.

begin;

-- Parent/guardian contact details ------------------------------------------------
alter table public.members add column if not exists primary_email_enc text;
alter table public.members add column if not exists primary_phone_enc text;
alter table public.members add column if not exists parent_email_hash text;

-- A member can be saved before an address exists (a school adding records in
-- bulk), and the plaintext column is emptied in step 2.
alter table public.members alter column primary_email drop not null;
alter table public.members alter column primary_phone drop not null;

create index if not exists members_parent_email_hash_idx
  on public.members (org_id, parent_email_hash);

alter table public.guardians add column if not exists email_enc text;
alter table public.guardians add column if not exists email_hash text;
alter table public.guardians alter column email drop not null;
alter table public.guardians alter column phone drop not null;

create index if not exists guardians_email_hash_idx on public.guardians (email_hash);
create index if not exists guardians_org_email_hash_idx on public.guardians (org_id, email_hash);

-- The school's emergency line, which parents see in every message.
alter table public.organizations add column if not exists emergency_phone_enc text;

-- Student edit: the app now sends the encrypted address and its index ------------
drop function if exists public.edit_member(uuid, text, text, text, text, text, text, uuid);

create or replace function public.edit_member(
  _member_id uuid,
  _pin text,
  _full_name text,
  _class text,
  _parent_name text,
  _email_enc text,
  _phone_enc text,
  _email_hash text,
  _branch_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.get_user_org_id(auth.uid());
  v_member record;
  v_secret record;
  v_classes text[];
  v_class text := nullif(btrim(coalesce(_class, '')), '');
begin
  if not public.has_role(auth.uid(), 'admin') or not public.mfa_ok() then
    raise exception 'Only administrators can edit student details';
  end if;
  select id, org_id, branch_id into v_member from public.members where id = _member_id;
  if v_member.id is null or v_member.org_id <> v_org or not public.in_my_branch(v_member.branch_id) then
    raise exception 'Student not found';
  end if;
  select * into v_secret from public.org_secrets where org_id = v_org for update;
  if v_secret.locked_until is not null and v_secret.locked_until > now() then
    return 'locked';
  end if;
  if v_secret.edit_pin is distinct from _pin then
    update public.org_secrets set
      failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
    where org_id = v_org;
    return 'wrong_code';
  end if;
  update public.org_secrets set failed_attempts = 0 where org_id = v_org;

  if char_length(btrim(coalesce(_full_name, ''))) not between 1 and 120 then
    raise exception 'Enter the student''s name';
  end if;
  -- The app encrypts contacts before they reach the database. Only ciphertext
  -- this server produced is accepted here, never a plain address. A record with
  -- no contact on file may pass null for both.
  if _email_enc is not null and _email_enc <> '' then
    if _email_enc !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
       or char_length(_email_enc) > 600 then
      raise exception 'The parent contact could not be saved securely';
    end if;
    if coalesce(_email_hash, '') !~ '^[a-f0-9]{64}$' then
      raise exception 'The parent contact could not be saved securely';
    end if;
  end if;
  if _phone_enc is not null and char_length(_phone_enc) > 600 then
    raise exception 'Some details are too long';
  end if;
  if char_length(coalesce(_parent_name, '')) > 120 then
    raise exception 'Some details are too long';
  end if;
  select classes into v_classes from public.organizations where id = v_org;
  if v_class is not null and coalesce(array_length(v_classes, 1), 0) > 0 then
    select c into v_class from unnest(v_classes) c where lower(c) = lower(v_class) limit 1;
    if v_class is null then raise exception 'Choose a class from your school''s list'; end if;
  end if;
  if _branch_id is not null and _branch_id is distinct from v_member.branch_id then
    if not public.is_hq_admin(auth.uid()) then
      raise exception 'Only headquarters can move a student to another branch';
    end if;
    if not exists (select 1 from public.branches b where b.id = _branch_id and b.org_id = v_org) then
      raise exception 'Branch not found';
    end if;
  end if;

  update public.members set
    full_name = btrim(_full_name),
    identifier_code = v_class,
    parent_or_owner_name = nullif(btrim(coalesce(_parent_name, '')), ''),
    primary_email = null,
    primary_phone = null,
    primary_email_enc = nullif(_email_enc, ''),
    primary_phone_enc = nullif(btrim(coalesce(_phone_enc, '')), ''),
    parent_email_hash = nullif(lower(_email_hash), ''),
    branch_id = coalesce(_branch_id, branch_id)
  where id = _member_id;
  return 'ok';
end;
$$;

revoke all on function public.edit_member(uuid, text, text, text, text, text, text, text, uuid)
  from public, anon;
grant execute on function public.edit_member(uuid, text, text, text, text, text, text, text, uuid)
  to authenticated;

commit;
