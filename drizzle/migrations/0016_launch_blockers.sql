-- Launch fixes: server-owned signup plan, first-photo QR rotation, gate email
-- outbox columns, and removal of dead anonymous registration RPCs.

-- 1. The chosen plan lives on the server-issued ticket, never in client auth
--    metadata. The trigger derives the trial from the ticket's plan.
ALTER TABLE public.signup_tickets
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'basic'
  CHECK (plan IN ('basic', 'standard', 'group'));

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
  IF v_meta->>'signup_kind' IS DISTINCT FROM 'org_admin' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_ticket := (v_meta->>'signup_ticket')::uuid;
  EXCEPTION WHEN others THEN
    v_ticket := NULL;
  END;
  UPDATE public.signup_tickets SET used_at = now()
  WHERE id = v_ticket AND lower(email) = lower(NEW.email) AND used_at IS NULL AND created_at > now() - interval '30 minutes'
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
  INSERT INTO public.organizations (name, type, admin_email, email_domain, emergency_phone, plan, trial_ends_at)
  VALUES (trim(v_meta->>'org_name'), v_type, NEW.email, v_domain, v_phone, v_plan,
    CASE WHEN v_plan = 'basic' THEN now() + interval '14 days' ELSE now() END)
  RETURNING id INTO v_org;
  INSERT INTO public.profiles (id, org_id, full_name, email)
  VALUES (NEW.id, v_org, coalesce(v_meta->>'full_name', ''), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_org_admin() FROM PUBLIC, anon, authenticated;

-- 2. Adding the first photo to a guardian must invalidate the pass that was
--    issued before the photo existed. Existing trigger now points at this body.
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
REVOKE EXECUTE ON FUNCTION public.guardians_pass_binding() FROM PUBLIC, anon, authenticated;

-- 3. Gate scans are queued for the server-side email sender. Clients only
--    insert gate_logs; these columns are service-role only.
ALTER TABLE public.gate_logs ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
CREATE INDEX IF NOT EXISTS gate_logs_pending_email_idx
  ON public.gate_logs (timestamp) WHERE emailed_at IS NULL;
CREATE INDEX IF NOT EXISTS transport_notices_pending_email_idx
  ON public.transport_notices (created_at) WHERE emailed_at IS NULL;
CREATE INDEX IF NOT EXISTS bus_emergencies_pending_email_idx
  ON public.bus_emergencies (created_at) WHERE emailed_at IS NULL;

-- Per-recipient delivery ledger makes cron retries idempotent.
CREATE TABLE IF NOT EXISTS public.email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id, email)
);
REVOKE ALL ON public.email_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.email_deliveries TO service_role;
ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;

-- 4. Deprecated anonymous registration helpers were replaced by
--    get_registration_branch(text); remove their call surface.
REVOKE ALL ON FUNCTION public.get_registration_org(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_registration_classes(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_registration_transport(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_free_email_domain(text) FROM PUBLIC, anon, authenticated;
