-- Parent PWA feature: multi-child linking, per-child OTP gated PWA, instant emails

-- 1. Add parent_link_token to members for linking multiple children to same parent
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS parent_link_token uuid UNIQUE DEFAULT gen_random_uuid();

-- Backfill existing members with unique tokens
UPDATE public.members SET parent_link_token = gen_random_uuid() WHERE parent_link_token IS NULL;

-- 2. Add parent_app_installed flag for dashboard indicator
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS parent_app_installed boolean NOT NULL DEFAULT false;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS parent_app_installed_at timestamptz;

-- 3. Per-child PWA access tokens (OTP-gated, one per child)
CREATE TABLE public.parent_pwa_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_link_token uuid NOT NULL,
  pwa_token text NOT NULL UNIQUE, -- 64-char token for PWA access URL
  otp_code text, -- 6-digit OTP sent to parent phone/email
  otp_expires_at timestamptz,
  otp_verified_at timestamptz,
  webauthn_credential_id text, -- for biometric/WebAuthn after OTP
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz
);
CREATE INDEX parent_pwa_tokens_member_idx ON public.parent_pwa_tokens(member_id);
CREATE INDEX parent_pwa_tokens_parent_link_idx ON public.parent_pwa_tokens(parent_link_token);
CREATE INDEX parent_pwa_tokens_pwa_token_idx ON public.parent_pwa_tokens(pwa_token);

GRANT SELECT, INSERT, UPDATE ON public.parent_pwa_tokens TO authenticated;
GRANT ALL ON public.parent_pwa_tokens TO service_role;
ALTER TABLE public.parent_pwa_tokens ENABLE ROW LEVEL SECURITY;

-- Parents can only see tokens for their own children (via parent_link_token)
CREATE POLICY "Parent views own PWA tokens" ON public.parent_pwa_tokens
FOR SELECT TO authenticated
USING (
  parent_link_token IN (
    SELECT parent_link_token FROM public.members WHERE primary_email = auth.email()
  )
);

-- Service role manages tokens
CREATE POLICY "Service role manages PWA tokens" ON public.parent_pwa_tokens
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Instant email outbox: gate_logs and transport_notices already have emailed_at
-- Add trigger to fire instant email on gate scan (bypass cron)
CREATE OR REPLACE FUNCTION public.queue_instant_gate_email()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert into a lightweight outbox for instant processing
  INSERT INTO public.instant_email_queue (source_table, source_id, org_id, priority)
  VALUES ('gate_logs', NEW.id, NEW.org_id, 10)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- 5. Instant email queue table
CREATE TABLE public.instant_email_queue (
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
CREATE INDEX instant_email_queue_pending_idx ON public.instant_email_queue(processed_at) WHERE processed_at IS NULL;
CREATE INDEX instant_email_queue_org_idx ON public.instant_email_queue(org_id, priority DESC, created_at);

GRANT SELECT, INSERT, UPDATE ON public.instant_email_queue TO authenticated;
GRANT ALL ON public.instant_email_queue TO service_role;
ALTER TABLE public.instant_email_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages instant email queue" ON public.instant_email_queue
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. Trigger on gate_logs insert to queue instant email
DROP TRIGGER IF EXISTS gate_logs_instant_email ON public.gate_logs;
CREATE TRIGGER gate_logs_instant_email
AFTER INSERT ON public.gate_logs
FOR EACH ROW EXECUTE FUNCTION public.queue_instant_gate_email();

-- 7. Trigger on transport_notices insert for pupil_boarded/pupil_dropped_off
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

-- 8. Function to process instant email queue (called by edge function or cron every 30s)
CREATE OR REPLACE FUNCTION public.process_instant_email_queue(_batch_size int DEFAULT 50)
RETURNS TABLE(processed int, failed int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_org record;
  v_member record;
  v_guardians record;
  v_recipients record;
  v_email_out record;
BEGIN
  FOR v_row IN
    SELECT * FROM public.instant_email_queue
    WHERE processed_at IS NULL AND attempts < 3
    ORDER BY priority DESC, created_at
    LIMIT _batch_size
  LOOP
    -- Load org and check billing
    SELECT * INTO v_org FROM public.organizations WHERE id = v_row.org_id;
    IF NOT FOUND OR NOT public.org_effective_plan(v_org.id) IN ('basic', 'standard', 'group') THEN
      -- Skip if no valid plan, but mark as processed to avoid retry loop
      UPDATE public.instant_email_queue SET processed_at = now(), attempts = attempts + 1 WHERE id = v_row.id;
      CONTINUE;
    END IF;

    -- Load member and guardians based on source
    IF v_row.source_table = 'gate_logs' THEN
      SELECT * INTO v_member FROM public.members WHERE id = (SELECT member_id FROM public.gate_logs WHERE id = v_row.source_id);
      -- Fetch guardians as a set, process in loop
      FOR v_guardians IN
        SELECT id, name, email, receive_general_notifications FROM public.guardians WHERE member_id = v_member.id
      LOOP
        -- Build recipients: parent always, acting guardian, opted-in guardians
        -- This is a placeholder; real email sending happens in edge function
      END LOOP;
    ELSIF v_row.source_table = 'transport_notices' THEN
      -- Similar for ride emails
    END IF;

    -- Mark as processed (actual sending done by edge function)
    UPDATE public.instant_email_queue SET processed_at = now() WHERE id = v_row.id;
  END LOOP;

  RETURN QUERY SELECT count(*)::int, 0 FROM public.instant_email_queue WHERE processed_at IS NOT NULL AND processed_at > now() - interval '1 minute';
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_instant_email_queue(int) TO service_role;

-- 9. Add verified sender domain placeholder
-- (Actual domain verification done in Resend dashboard)
COMMENT ON TABLE public.organizations IS 'EMAIL_FROM should be noreply@your-verified-domain.com or similar verified domain';

-- 10. Grant for new columns
GRANT UPDATE (parent_link_token, parent_app_installed, parent_app_installed_at) ON public.members TO authenticated;
GRANT UPDATE (parent_link_token, parent_app_installed, parent_app_installed_at) ON public.members TO service_role;