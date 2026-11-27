-- GoGuard Complete Database Setup for Signup
-- Run this in Supabase SQL Editor AFTER deleting all tables (optional, but cleanest)
-- This script is idempotent (safe to re-run)

-- ============================================================
-- 1. EXTENSIONS & ENUMS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE public.org_type AS ENUM ('school', 'estate', 'corporate');
CREATE TYPE public.app_role AS ENUM ('admin', 'guard', 'driver', 'attendant');
CREATE TYPE public.gate_action AS ENUM ('check_in', 'check_out');

-- ============================================================
-- 2. CORE TABLES (created first so functions can reference them)
-- ============================================================

-- Organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type public.org_type NOT NULL,
  admin_email text NOT NULL,
  email_domain text,
  registration_token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  emergency_phone text,
  plan text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic', 'standard', 'group')),
  trial_ends_at timestamptz,
  paid_until timestamptz,
  transport_enabled boolean NOT NULL DEFAULT false,
  transport_paid_until timestamptz,
  classes text[] NOT NULL DEFAULT '{}'
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  full_name text,
  email text,
  branch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User Roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  branch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role, branch_id)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Signup Tickets
CREATE TABLE IF NOT EXISTS public.signup_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  plan text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic', 'standard', 'group')),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

ALTER TABLE public.signup_tickets ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. CORE FUNCTIONS (now tables exist)
-- ============================================================

-- Free email domain check (used by signup trigger)
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

-- Get user's organization ID from auth.uid()
CREATE OR REPLACE FUNCTION public.get_user_org_id(_uid uuid DEFAULT auth.uid())
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM public.profiles WHERE id = _uid
$$;

-- Check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role = _role
  )
$$;

-- Effective billing plan for an org (used by email sending)
CREATE OR REPLACE FUNCTION public.org_effective_plan(_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN paid_until IS NOT NULL AND paid_until > now() THEN plan
      WHEN trial_ends_at IS NOT NULL AND trial_ends_at > now() THEN plan
      ELSE 'none'
    END
  FROM public.organizations WHERE id = _org_id
$$;

-- ============================================================
-- 4. RLS POLICIES
-- ============================================================

-- Organizations policies
DROP POLICY IF EXISTS "Org members view own org" ON public.organizations;
CREATE POLICY "Org members view own org" ON public.organizations
FOR SELECT TO authenticated
USING (id = public.get_user_org_id());

DROP POLICY IF EXISTS "Admins update own org" ON public.organizations;
CREATE POLICY "Admins update own org" ON public.organizations
FOR UPDATE TO authenticated
USING (id = public.get_user_org_id() AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (id = public.get_user_org_id() AND public.has_role(auth.uid(), 'admin'));

-- Profiles policies
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles
FOR SELECT TO authenticated
USING (id = auth.uid() OR org_id = public.get_user_org_id());

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- User Roles policies
DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Signup Tickets - only service role
DROP POLICY IF EXISTS "Service role manages signup tickets" ON public.signup_tickets;
CREATE POLICY "Service role manages signup tickets" ON public.signup_tickets
FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.signup_tickets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.signup_tickets TO service_role;

-- ============================================================
-- 5. SIGNUP TRIGGER FUNCTION (handles org creation on auth signup)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_org_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  v_type public.org_type;
  v_domain text := lower(split_part(NEW.email, '@', 2));
  v_org uuid;
  v_phone text := nullif(left(trim(coalesce(v_meta->>'emergency_phone', '')), 30), '');
  v_plan text := 'basic';
  v_ticket_plan text;
  v_ticket uuid;
BEGIN
  -- Only handle org_admin signups
  IF v_meta->>'signup_kind' IS DISTINCT FROM 'org_admin' THEN
    RETURN NEW;
  END IF;

  -- Validate and consume signup ticket
  BEGIN
    v_ticket := (v_meta->>'signup_ticket')::uuid;
  EXCEPTION WHEN others THEN
    v_ticket := NULL;
  END;

  UPDATE public.signup_tickets SET used_at = now()
  WHERE id = v_ticket
    AND lower(email) = lower(NEW.email)
    AND used_at IS NULL
    AND created_at > now() - interval '30 minutes'
  RETURNING id, plan INTO v_ticket, v_ticket_plan;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'Sign-up check failed. Please complete the security check and try again.';
  END IF;

  v_plan := coalesce(v_ticket_plan, 'basic');
  IF v_plan NOT IN ('basic', 'standard', 'group') THEN v_plan := 'basic'; END IF;

  v_type := (v_meta->>'org_type')::public.org_type;
  IF coalesce(trim(v_meta->>'org_name'), '') = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  IF v_type = 'school' AND public.is_free_email_domain(v_domain) THEN
    RAISE EXCEPTION 'Schools must sign up with an official school domain email';
  END IF;

  -- Create organization
  INSERT INTO public.organizations (name, type, admin_email, email_domain, emergency_phone, plan, trial_ends_at)
  VALUES (trim(v_meta->>'org_name'), v_type, NEW.email, v_domain, v_phone, v_plan,
    CASE WHEN v_plan = 'basic' THEN now() + interval '14 days' ELSE now() END)
  RETURNING id INTO v_org;

  -- Create profile
  INSERT INTO public.profiles (id, org_id, full_name, email)
  VALUES (NEW.id, v_org, coalesce(v_meta->>'full_name', ''), NEW.email);

  -- Assign admin role
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');

  RETURN NEW;
END;
$$;

-- ============================================================
-- 6. TRIGGER ON auth.users
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created_org_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_org_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_org_admin();

-- ============================================================
-- 7. GRANTS FOR SERVICE ROLE
-- ============================================================
GRANT ALL ON public.organizations TO service_role;
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.user_roles TO service_role;
GRANT ALL ON public.signup_tickets TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_org_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_free_email_domain(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_org_id(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_effective_plan(uuid) TO service_role;

-- Authenticated user grants (minimal)
GRANT SELECT, INSERT, UPDATE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.signup_tickets TO authenticated;

-- ============================================================
-- 8. GUARDIANS PASS BINDING (for QR codes)
-- ============================================================
CREATE OR REPLACE FUNCTION public.guardians_pass_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.unique_qr_hash := replace(gen_random_uuid()::text, '-', '')
                       || replace(gen_random_uuid()::text, '-', '');
    RETURN NEW;
  END IF;
  IF NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.photo_path IS DISTINCT FROM OLD.photo_path THEN
    NEW.unique_qr_hash := replace(gen_random_uuid()::text, '-', '')
                       || replace(gen_random_uuid()::text, '-', '');
  ELSE
    NEW.unique_qr_hash := OLD.unique_qr_hash;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 9. EMAIL DELIVERIES TABLE (for instant email queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id, email)
);

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages email deliveries" ON public.email_deliveries;
CREATE POLICY "Service role manages email deliveries" ON public.email_deliveries
FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.email_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.email_deliveries TO service_role;

-- ============================================================
-- 10. PARENT PWA TABLES (for parent app feature)
-- ============================================================
-- Note: members table must exist from earlier migrations
-- Parent link token on members
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS parent_link_token uuid UNIQUE DEFAULT gen_random_uuid();
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS parent_app_installed boolean NOT NULL DEFAULT false;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS parent_app_installed_at timestamptz;

UPDATE public.members SET parent_link_token = gen_random_uuid() WHERE parent_link_token IS NULL;

-- Parent PWA tokens
CREATE TABLE IF NOT EXISTS public.parent_pwa_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_link_token uuid NOT NULL,
  pwa_token text NOT NULL UNIQUE,
  otp_code text,
  otp_expires_at timestamptz,
  otp_verified_at timestamptz,
  webauthn_credential_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz
);

CREATE INDEX IF NOT EXISTS parent_pwa_tokens_member_idx ON public.parent_pwa_tokens(member_id);
CREATE INDEX IF NOT EXISTS parent_pwa_tokens_parent_link_idx ON public.parent_pwa_tokens(parent_link_token);
CREATE INDEX IF NOT EXISTS parent_pwa_tokens_pwa_token_idx ON public.parent_pwa_tokens(pwa_token);

ALTER TABLE public.parent_pwa_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parent views own PWA tokens" ON public.parent_pwa_tokens;
CREATE POLICY "Parent views own PWA tokens" ON public.parent_pwa_tokens
FOR SELECT TO authenticated
USING (
  parent_link_token IN (
    SELECT parent_link_token FROM public.members WHERE primary_email = auth.email()
  )
);

DROP POLICY IF EXISTS "Service role manages PWA tokens" ON public.parent_pwa_tokens;
CREATE POLICY "Service role manages PWA tokens" ON public.parent_pwa_tokens
FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.parent_pwa_tokens TO authenticated;
GRANT ALL ON public.parent_pwa_tokens TO service_role;

-- ============================================================
-- 11. INSTANT EMAIL QUEUE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.instant_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL CHECK (source_table IN ('gate_logs', 'transport_notices', 'bus_emergencies')),
  source_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 5,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (source_table, source_id)
);

CREATE INDEX IF NOT EXISTS instant_email_queue_pending_idx ON public.instant_email_queue(processed_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS instant_email_queue_org_idx ON public.instant_email_queue(org_id, priority DESC, created_at);

ALTER TABLE public.instant_email_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages instant email queue" ON public.instant_email_queue;
CREATE POLICY "Service role manages instant email queue" ON public.instant_email_queue
FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.instant_email_queue TO authenticated;
GRANT ALL ON public.instant_email_queue TO service_role;

-- Gate logs trigger for instant email
CREATE OR REPLACE FUNCTION public.queue_instant_gate_email()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.instant_email_queue (source_table, source_id, org_id, priority)
  VALUES ('gate_logs', NEW.id, NEW.org_id, 10)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gate_logs_instant_email ON public.gate_logs;
CREATE TRIGGER gate_logs_instant_email
AFTER INSERT ON public.gate_logs
FOR EACH ROW EXECUTE FUNCTION public.queue_instant_gate_email();

-- Transport notices trigger
CREATE OR REPLACE FUNCTION public.queue_instant_ride_email()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.kind IN ('pupil_boarded', 'pupil_dropped_off') AND NEW.member_id IS NOT NULL THEN
    INSERT INTO public.instant_email_queue (source_table, source_id, org_id, priority)
    VALUES ('transport_notices', NEW.id, NEW.org_id, 10)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transport_notices_instant_email ON public.transport_notices;
CREATE TRIGGER transport_notices_instant_email
AFTER INSERT ON public.transport_notices
FOR EACH ROW EXECUTE FUNCTION public.queue_instant_ride_email();

-- ============================================================
-- 12. PUSH SUBSCRIPTIONS (for push notifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_link_token uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS push_subscriptions_parent_link_idx ON public.push_subscriptions(parent_link_token);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parent manages own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Parent manages own push subscriptions" ON public.push_subscriptions
FOR ALL TO authenticated
USING (
  parent_link_token IN (
    SELECT parent_link_token FROM public.members WHERE primary_email = auth.email()
  )
)
WITH CHECK (
  parent_link_token IN (
    SELECT parent_link_token FROM public.members WHERE primary_email = auth.email()
  )
);

DROP POLICY IF EXISTS "Service role manages push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Service role manages push subscriptions" ON public.push_subscriptions
FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

-- ============================================================
-- 13. FINAL GRANTS
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;