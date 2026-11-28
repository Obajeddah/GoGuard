-- Contact encryption, step 2 of 2: remove the plaintext.
--
-- Run this only after:
--   1. contact-encryption-1-add.sql has been applied,
--   2. the new app version is deployed,
--   3. `node scripts/encrypt-contacts.mjs` has reported 0 remaining rows.
--
-- It empties every legacy contact column, removes it from what a signed-in
-- school account may read, and points the registration link at the encrypted
-- emergency line. The empty columns stay in place so older code and database
-- functions that mention them keep working; they hold no contact details.

begin;

-- 1. Empty the plaintext -----------------------------------------------------------
update public.members set primary_email = null, primary_phone = null;
update public.guardians set email = null, phone = null;
update public.organizations set emergency_phone = null;

comment on column public.members.primary_email_enc is
  'AES-256-GCM ciphertext of the parent email (app key only). Plaintext is never stored.';
comment on column public.members.primary_phone_enc is
  'AES-256-GCM ciphertext of the parent phone. Plaintext is never stored.';
comment on column public.members.parent_email_hash is
  'HMAC-SHA256 blind index of the normalised parent email, for exact lookups.';
comment on column public.guardians.email_enc is
  'AES-256-GCM ciphertext of the guardian email. Plaintext is never stored.';
comment on column public.guardians.email_hash is
  'HMAC-SHA256 blind index of the normalised guardian email.';
comment on column public.organizations.emergency_phone_enc is
  'AES-256-GCM ciphertext of the school emergency line shown to parents.';

-- 2. Stop school accounts reading the contact columns ------------------------------
-- The app needs names, classes, photos and passes; it never needs an address.
do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'members'
     and column_name not in (
       'primary_email', 'primary_phone',
       'primary_email_enc', 'primary_phone_enc', 'parent_email_hash'
     );
  if cols is not null then
    revoke select on public.members from authenticated, anon;
    execute format('grant select (%s) on public.members to authenticated', cols);
  end if;
end $$;

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'guardians'
     and column_name not in ('email', 'phone', 'email_enc', 'email_hash');
  if cols is not null then
    revoke select on public.guardians from authenticated, anon;
    execute format('grant select (%s) on public.guardians to authenticated', cols);
  end if;
end $$;

-- 3. The public registration page now receives the encrypted emergency line --------
drop function if exists public.get_registration_branch(text);

create or replace function public.get_registration_branch(_token text)
returns table (
  org_id uuid,
  org_name text,
  org_type public.org_type,
  emergency_phone text,
  emergency_phone_enc text,
  branch_id uuid,
  branch_name text,
  branch_count integer,
  classes text[],
  transport boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.type, null::text, o.emergency_phone_enc, b.id, b.name,
    (select count(*)::int from public.branches x where x.org_id = o.id),
    o.classes, public.org_transport_active(o.id)
  from public.branches b
  join public.organizations o on o.id = b.org_id
  where b.registration_token = _token;
$$;

revoke all on function public.get_registration_branch(text) from public;
grant execute on function public.get_registration_branch(text) to anon, authenticated, service_role;

-- 4. Remove the parent policies that matched on a plain address --------------------
-- The parent app never queries these tables with a signed-in parent: it reaches them
-- through token-checked server functions with the service role. These policies only
-- referenced the old plaintext column, so they are removed rather than left to fail.
drop policy if exists "Parent views own PWA tokens" on public.parent_pwa_tokens;
drop policy if exists "Parent manages own push subscriptions" on public.push_subscriptions;

-- 5. Retire the old SQL sender that read guardian addresses directly ---------------
-- The app sends mail from the server, where it can decrypt. This function could
-- only ever see nulls from now on, so leaving it callable would silently stop
-- parent notifications.
drop function if exists public.process_instant_email_queue(int);

commit;
