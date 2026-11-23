-- Enums
CREATE TYPE public.org_type AS ENUM ('school', 'estate', 'corporate');
CREATE TYPE public.app_role AS ENUM ('admin', 'guard');
CREATE TYPE public.gate_action AS ENUM ('check_in', 'check_out');

-- Free / consumer email providers that are not accepted for school signups
CREATE OR REPLACE FUNCTION public.is_free_email_domain(_domain text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(coalesce(_domain, '')) = ANY (ARRAY[
    'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com','rocketmail.com',
    'hotmail.com','hotmail.co.uk','outlook.com','live.com','msn.com','icloud.com','me.com','mac.com',
    'aol.com','proton.me','protonmail.com','gmx.com','gmx.net','mail.com','zoho.com','yandex.com',
    'yandex.ru','tutanota.com','fastmail.com','hey.com','qq.com','163.com','126.com','mail.ru',
    'inbox.com','pm.me','duck.com','mailinator.com','tempmail.com','10minutemail.com','guerrillamail.com'
  ])
$$;

-- Organizations
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type public.org_type NOT NULL,
  admin_email text NOT NULL,
  email_domain text,
  registration_token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.organizations TO authenticated;
GRANT UPDATE (name, registration_token) ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_org_idx ON public.profiles(org_id);
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Roles (separate table)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Helper functions
CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.profiles WHERE id = _user_id
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Members (student / resident / employee)
CREATE TABLE public.members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  identifier_code text,
  photo_path text,
  parent_or_owner_name text,
  primary_email text NOT NULL,
  primary_phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX members_org_idx ON public.members(org_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.members TO authenticated;
GRANT ALL ON public.members TO service_role;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

-- Guardians (up to 4 per member), each with their own QR pass
CREATE TABLE public.guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship text NOT NULL,
  email text NOT NULL,
  phone text,
  photo_path text,
  receive_general_notifications boolean NOT NULL DEFAULT false,
  unique_qr_hash text NOT NULL UNIQUE DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guardians_member_idx ON public.guardians(member_id);
CREATE INDEX guardians_org_idx ON public.guardians(org_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardians TO authenticated;
GRANT ALL ON public.guardians TO service_role;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.guardians_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_count int;
BEGIN
  SELECT org_id INTO v_org FROM public.members WHERE id = NEW.member_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  NEW.org_id := v_org;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO v_count FROM public.guardians WHERE member_id = NEW.member_id;
    IF v_count >= 4 THEN
      RAISE EXCEPTION 'A maximum of 4 guardians can be registered per member';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guardians_before_write
BEFORE INSERT OR UPDATE OF member_id ON public.guardians
FOR EACH ROW EXECUTE FUNCTION public.guardians_before_write();

-- Gate logs
CREATE TABLE public.gate_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  guardian_id uuid REFERENCES public.guardians(id) ON DELETE SET NULL,
  scanned_by_guard_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_type public.gate_action NOT NULL,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  verified_guardian_name text,
  member_name text,
  guard_name text
);
CREATE INDEX gate_logs_org_time_idx ON public.gate_logs(org_id, "timestamp" DESC);
GRANT SELECT, INSERT ON public.gate_logs TO authenticated;
GRANT ALL ON public.gate_logs TO service_role;
ALTER TABLE public.gate_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.gate_logs_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member record;
  v_guardian record;
BEGIN
  SELECT id, org_id, full_name INTO v_member FROM public.members WHERE id = NEW.member_id;
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  NEW.org_id := v_member.org_id;
  NEW.member_name := v_member.full_name;
  IF NEW.guardian_id IS NOT NULL THEN
    SELECT id, member_id, name INTO v_guardian FROM public.guardians WHERE id = NEW.guardian_id;
    IF v_guardian.id IS NULL OR v_guardian.member_id <> NEW.member_id THEN
      RAISE EXCEPTION 'Guardian is not authorized for this member';
    END IF;
    NEW.verified_guardian_name := v_guardian.name;
  END IF;
  SELECT full_name INTO NEW.guard_name FROM public.profiles WHERE id = NEW.scanned_by_guard_id;
  NEW."timestamp" := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER gate_logs_before_insert
BEFORE INSERT ON public.gate_logs
FOR EACH ROW EXECUTE FUNCTION public.gate_logs_before_insert();

-- RLS policies
CREATE POLICY "Org users view their organization" ON public.organizations
FOR SELECT TO authenticated USING (id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Admins update their organization" ON public.organizations
FOR UPDATE TO authenticated
USING (id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Org users view profiles in their org" ON public.profiles
FOR SELECT TO authenticated USING (org_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Users update own profile" ON public.profiles
FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Users view own roles" ON public.user_roles
FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins view roles in their org" ON public.user_roles
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') AND public.get_user_org_id(user_id) = public.get_user_org_id(auth.uid()));

CREATE POLICY "Org users view members" ON public.members
FOR SELECT TO authenticated USING (org_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Admins insert members" ON public.members
FOR INSERT TO authenticated WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update members" ON public.members
FOR UPDATE TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete members" ON public.members
FOR DELETE TO authenticated USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Org users view guardians" ON public.guardians
FOR SELECT TO authenticated USING (org_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Admins insert guardians" ON public.guardians
FOR INSERT TO authenticated WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update guardians" ON public.guardians
FOR UPDATE TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete guardians" ON public.guardians
FOR DELETE TO authenticated USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Org users view gate logs" ON public.gate_logs
FOR SELECT TO authenticated USING (org_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Staff record gate logs" ON public.gate_logs
FOR INSERT TO authenticated
WITH CHECK (
  scanned_by_guard_id = auth.uid()
  AND org_id = public.get_user_org_id(auth.uid())
  AND (public.has_role(auth.uid(), 'guard') OR public.has_role(auth.uid(), 'admin'))
);

-- Signup trigger: create organization + admin when an org admin signs up
CREATE OR REPLACE FUNCTION public.handle_new_org_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  v_type public.org_type;
  v_domain text := lower(split_part(NEW.email, '@', 2));
  v_org uuid;
BEGIN
  IF v_meta->>'signup_kind' IS DISTINCT FROM 'org_admin' THEN
    RETURN NEW;
  END IF;
  v_type := (v_meta->>'org_type')::public.org_type;
  IF coalesce(trim(v_meta->>'org_name'), '') = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;
  IF v_type = 'school' AND public.is_free_email_domain(v_domain) THEN
    RAISE EXCEPTION 'Schools must sign up with an official school domain email';
  END IF;
  INSERT INTO public.organizations (name, type, admin_email, email_domain)
  VALUES (trim(v_meta->>'org_name'), v_type, NEW.email, v_domain)
  RETURNING id INTO v_org;
  INSERT INTO public.profiles (id, org_id, full_name, email)
  VALUES (NEW.id, v_org, coalesce(v_meta->>'full_name', ''), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created_org_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_org_admin();

-- Public lookups (anon) for the registration link
CREATE OR REPLACE FUNCTION public.get_registration_org(_token text)
RETURNS TABLE (id uuid, name text, type public.org_type)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.name, o.type FROM public.organizations o WHERE o.registration_token = _token
$$;
REVOKE ALL ON FUNCTION public.get_registration_org(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_registration_org(text) TO anon, authenticated, service_role;

-- Realtime for live gate logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.gate_logs;
