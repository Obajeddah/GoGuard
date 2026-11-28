-- Plans: Basic Gate (trial-eligible), Campus Standard, Multi-Campus Group
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'basic';
ALTER TABLE public.organizations ADD CONSTRAINT organizations_plan_check CHECK (plan IN ('basic', 'standard', 'group'));
COMMENT ON COLUMN public.organizations.plan IS 'Current tier. Written only by the sign-up trigger and server-side payment settlement.';
UPDATE public.organizations SET plan = 'group' WHERE transport_paid_until > now();
COMMENT ON COLUMN public.organizations.transport_paid_until IS 'DEPRECATED: transport now comes from plan (standard/group) with paid_until.';
COMMENT ON COLUMN public.organizations.transport_enabled IS 'DEPRECATED: transport now comes from plan (standard/group).';
COMMENT ON COLUMN public.organizations.registration_token IS 'DEPRECATED: registration links live on branches; the main branch keeps this token so old links still work.';

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_plan_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_plan_check
  CHECK (plan IN ('monthly', 'yearly', 'transport', 'session', 'basic', 'standard', 'group'));
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS branch_count integer;

REVOKE UPDATE ON public.organizations FROM authenticated;
GRANT UPDATE (name, emergency_phone, classes) ON public.organizations TO authenticated;

CREATE OR REPLACE FUNCTION public.org_effective_plan(_org_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN o.paid_until > now() THEN o.plan
    WHEN o.trial_ends_at > now() THEN 'trial'
    ELSE 'none'
  END
  FROM public.organizations o WHERE o.id = _org_id
$$;

CREATE OR REPLACE FUNCTION public.org_transport_active(_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.org_effective_plan(_org_id) IN ('standard', 'group'), false)
$$;

CREATE OR REPLACE FUNCTION public.org_max_buses(_org_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.org_effective_plan(_org_id) WHEN 'standard' THEN 4 WHEN 'group' THEN 6 ELSE 0 END
$$;

-- Branches
CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  address text CHECK (address IS NULL OR char_length(address) <= 200),
  is_main boolean NOT NULL DEFAULT false,
  registration_token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  guard_invite_token text NOT NULL UNIQUE DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX branches_one_main ON public.branches(org_id) WHERE is_main;
CREATE UNIQUE INDEX branches_org_name ON public.branches(org_id, lower(btrim(name)));
GRANT SELECT, DELETE ON public.branches TO authenticated;
GRANT INSERT (org_id, name, address) ON public.branches TO authenticated;
GRANT UPDATE (name, address, registration_token, guard_invite_token) ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

INSERT INTO public.branches (org_id, name, is_main, registration_token)
SELECT o.id, 'Main campus', true, o.registration_token FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.org_id = o.id AND b.is_main);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.profiles.branch_id IS 'NULL = headquarters (all branches). Set only by the server.';
UPDATE public.profiles p SET branch_id = b.id
FROM public.branches b
WHERE b.org_id = p.org_id AND b.is_main
  AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'admin');

CREATE OR REPLACE FUNCTION public.get_user_branch_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.profiles WHERE id = _user_id
$$;

CREATE OR REPLACE FUNCTION public.in_my_branch(_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT p.branch_id IS NULL OR p.branch_id = _branch_id FROM public.profiles p WHERE p.id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION public.mfa_ok()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT public.has_role(auth.uid(), 'admin') OR coalesce(auth.jwt()->>'aal', '') = 'aal2'
$$;

CREATE OR REPLACE FUNCTION public.staff_scope(_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.in_my_branch(_branch_id) AND public.mfa_ok()
$$;

CREATE OR REPLACE FUNCTION public.is_hq_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.branch_id IS NULL)
$$;

CREATE OR REPLACE FUNCTION public.main_branch_id(_org_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.branches WHERE org_id = _org_id AND is_main
$$;

CREATE POLICY "Org users view branches" ON public.branches FOR SELECT TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.staff_scope(id));
CREATE POLICY "HQ admins add branches" ON public.branches FOR INSERT TO authenticated
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.is_hq_admin(auth.uid()) AND public.mfa_ok());
CREATE POLICY "Admins update branches" ON public.branches FOR UPDATE TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin') AND public.staff_scope(id))
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin') AND public.staff_scope(id));
CREATE POLICY "HQ admins delete branches" ON public.branches FOR DELETE TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.is_hq_admin(auth.uid()) AND public.mfa_ok() AND NOT is_main);

CREATE OR REPLACE FUNCTION public.branches_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  IF NOT NEW.is_main AND coalesce(public.org_effective_plan(NEW.org_id), 'none') <> 'group' THEN
    RAISE EXCEPTION 'Branches need the Multi-Campus Group plan';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER branches_before_insert BEFORE INSERT ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.branches_before_insert();

CREATE TABLE public.org_secrets (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  edit_pin text NOT NULL DEFAULT lpad(floor(random() * 10000)::int::text, 4, '0') CHECK (edit_pin ~ '^[0-9]{4}$'),
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.org_secrets TO authenticated;
GRANT UPDATE (edit_pin) ON public.org_secrets TO authenticated;
GRANT ALL ON public.org_secrets TO service_role;
ALTER TABLE public.org_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "HQ admins view the edit code" ON public.org_secrets FOR SELECT TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.is_hq_admin(auth.uid()) AND public.mfa_ok());
CREATE POLICY "HQ admins change the edit code" ON public.org_secrets FOR UPDATE TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.is_hq_admin(auth.uid()) AND public.mfa_ok())
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.is_hq_admin(auth.uid()) AND public.mfa_ok());
INSERT INTO public.org_secrets (org_id) SELECT id FROM public.organizations ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.organizations_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.branches (org_id, name, is_main, registration_token)
  VALUES (NEW.id, 'Main campus', true, NEW.registration_token);
  INSERT INTO public.org_secrets (org_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organizations_after_insert AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.organizations_after_insert();

CREATE OR REPLACE FUNCTION public.org_secrets_before_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.edit_pin IS DISTINCT FROM OLD.edit_pin THEN
    NEW.failed_attempts := 0;
    NEW.locked_until := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER org_secrets_before_update BEFORE UPDATE ON public.org_secrets
FOR EACH ROW EXECUTE FUNCTION public.org_secrets_before_update();

-- Branch columns on school data (filled by triggers, never by clients)
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;
UPDATE public.members m SET branch_id = public.main_branch_id(m.org_id) WHERE branch_id IS NULL;
ALTER TABLE public.members ALTER COLUMN branch_id SET NOT NULL;
CREATE INDEX members_branch_idx ON public.members(branch_id);

ALTER TABLE public.guardians ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;
UPDATE public.guardians g SET branch_id = m.branch_id FROM public.members m WHERE m.id = g.member_id AND g.branch_id IS NULL;

ALTER TABLE public.gate_logs ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;
UPDATE public.gate_logs l SET branch_id = m.branch_id FROM public.members m WHERE m.id = l.member_id AND l.branch_id IS NULL;
CREATE INDEX gate_logs_branch_time_idx ON public.gate_logs(branch_id, "timestamp" DESC);

ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;
UPDATE public.buses b SET branch_id = public.main_branch_id(b.org_id) WHERE branch_id IS NULL;

ALTER TABLE public.bus_trips ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;
UPDATE public.bus_trips t SET branch_id = b.branch_id FROM public.buses b WHERE b.id = t.bus_id AND t.branch_id IS NULL;

ALTER TABLE public.bus_trip_points ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;
UPDATE public.bus_trip_points p SET branch_id = t.branch_id FROM public.bus_trips t WHERE t.id = p.trip_id AND p.branch_id IS NULL;

ALTER TABLE public.pupil_bus_logs ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;
UPDATE public.pupil_bus_logs l SET branch_id = t.branch_id FROM public.bus_trips t WHERE t.id = l.trip_id AND l.branch_id IS NULL;

ALTER TABLE public.transport_notices ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;
UPDATE public.transport_notices n SET branch_id = coalesce(
  (SELECT m.branch_id FROM public.members m WHERE m.id = n.member_id),
  (SELECT b.branch_id FROM public.buses b WHERE b.id = n.bus_id),
  public.main_branch_id(n.org_id))
WHERE n.branch_id IS NULL;

ALTER TABLE public.bus_crew ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;
UPDATE public.bus_crew c SET branch_id = b.branch_id FROM public.buses b WHERE b.id = c.bus_id AND c.branch_id IS NULL;
COMMENT ON TABLE public.bus_crew IS 'DEPRECATED: replaced by one login per bus (buses.login_user_id) and crew names on buses.';

CREATE OR REPLACE FUNCTION public.members_branch_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_branch uuid := public.get_user_branch_id(auth.uid());
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.branch_id IS NULL THEN
      NEW.branch_id := coalesce(v_my_branch, public.main_branch_id(NEW.org_id));
    END IF;
  ELSIF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND v_my_branch IS NOT NULL AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Only headquarters can move a student to another branch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id AND b.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'This branch does not belong to this school';
  END IF;
  IF NEW.bus_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.buses b WHERE b.id = NEW.bus_id AND b.branch_id = NEW.branch_id
  ) THEN
    IF TG_OP = 'UPDATE' AND NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      NEW.bus_id := NULL;
    ELSE
      RAISE EXCEPTION 'This bus belongs to another branch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER members_branch_before_write BEFORE INSERT OR UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.members_branch_before_write();

CREATE OR REPLACE FUNCTION public.members_branch_after_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    UPDATE public.guardians SET branch_id = NEW.branch_id WHERE member_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER members_branch_after_update AFTER UPDATE OF branch_id ON public.members
FOR EACH ROW EXECUTE FUNCTION public.members_branch_after_update();

CREATE OR REPLACE FUNCTION public.guardians_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_branch uuid;
  v_count int;
BEGIN
  SELECT org_id, branch_id INTO v_org, v_branch FROM public.members WHERE id = NEW.member_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  NEW.org_id := v_org;
  NEW.branch_id := v_branch;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO v_count FROM public.guardians WHERE member_id = NEW.member_id;
    IF v_count >= 4 THEN
      RAISE EXCEPTION 'A maximum of 4 guardians can be registered per member';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guardians_before_write ON public.guardians;
CREATE TRIGGER guardians_before_write
BEFORE INSERT OR UPDATE OF member_id, branch_id ON public.guardians
FOR EACH ROW EXECUTE FUNCTION public.guardians_before_write();

CREATE OR REPLACE FUNCTION public.gate_logs_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member record;
  v_guardian record;
BEGIN
  SELECT id, org_id, branch_id, full_name INTO v_member FROM public.members WHERE id = NEW.member_id;
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  NEW.org_id := v_member.org_id;
  NEW.branch_id := v_member.branch_id;
  NEW.member_name := v_member.full_name;
  IF NEW.guardian_id IS NOT NULL THEN
    SELECT id, member_id, name INTO v_guardian FROM public.guardians WHERE id = NEW.guardian_id;
    IF v_guardian.id IS NULL OR v_guardian.member_id <> NEW.member_id THEN
      RAISE EXCEPTION 'Guardian is not authorized for this member';
    END IF;
    NEW.verified_guardian_name := v_guardian.name;
  END IF;
  SELECT full_name INTO NEW.guard_name FROM public.profiles WHERE id = NEW.scanned_by_guard_id;
  IF NEW."timestamp" IS NULL OR NEW."timestamp" > now() OR NEW."timestamp" < now() - interval '24 hours' THEN
    NEW."timestamp" := now();
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.gate_logs ADD COLUMN IF NOT EXISTS client_id text UNIQUE;

-- Buses: one login per bus, crew names, plan limits
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS login_user_id uuid UNIQUE;
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS login_email text;
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS login_active boolean NOT NULL DEFAULT false;
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS driver_name text CHECK (driver_name IS NULL OR char_length(driver_name) <= 120);
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS driver_phone text CHECK (driver_phone IS NULL OR char_length(driver_phone) <= 30);
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS attendant_name text CHECK (attendant_name IS NULL OR char_length(attendant_name) <= 120);
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS attendant_phone text CHECK (attendant_phone IS NULL OR char_length(attendant_phone) <= 30);
COMMENT ON COLUMN public.buses.login_user_id IS 'The bus login (role bus). Its device is the only location source for this bus. Set only by the server.';

UPDATE public.buses b SET
  driver_name = (SELECT p.full_name FROM public.bus_crew c JOIN public.profiles p ON p.id = c.driver_profile_id WHERE c.bus_id = b.id),
  attendant_name = (SELECT p.full_name FROM public.bus_crew c JOIN public.profiles p ON p.id = c.attendant_profile_id WHERE c.bus_id = b.id);

REVOKE INSERT, UPDATE ON public.buses FROM authenticated;
GRANT INSERT (org_id, branch_id, bus_number, plate_number, route_axis, driver_name, driver_phone, attendant_name, attendant_phone)
  ON public.buses TO authenticated;
GRANT UPDATE (branch_id, bus_number, plate_number, route_axis, driver_name, driver_phone, attendant_name, attendant_phone)
  ON public.buses TO authenticated;

CREATE OR REPLACE FUNCTION public.buses_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_branch uuid := public.get_user_branch_id(auth.uid());
  v_max int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.branch_id IS NULL THEN
      NEW.branch_id := coalesce(v_my_branch, public.main_branch_id(NEW.org_id));
    END IF;
    v_max := public.org_max_buses(NEW.org_id);
    IF v_max = 0 THEN
      RAISE EXCEPTION 'Buses need the Campus Standard or Multi-Campus Group plan';
    END IF;
    IF (SELECT count(*) FROM public.buses WHERE org_id = NEW.org_id) >= v_max THEN
      RAISE EXCEPTION 'Your plan allows up to % buses', v_max;
    END IF;
  ELSIF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    IF v_my_branch IS NOT NULL AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Only headquarters can move a bus to another branch';
    END IF;
    IF EXISTS (SELECT 1 FROM public.members m WHERE m.bus_id = NEW.id) THEN
      RAISE EXCEPTION 'Take the pupils off this bus before moving it to another branch';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id AND b.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'This branch does not belong to this school';
  END IF;
  NEW.driver_name := nullif(btrim(coalesce(NEW.driver_name, '')), '');
  NEW.attendant_name := nullif(btrim(coalesce(NEW.attendant_name, '')), '');
  NEW.driver_phone := nullif(btrim(coalesce(NEW.driver_phone, '')), '');
  NEW.attendant_phone := nullif(btrim(coalesce(NEW.attendant_phone, '')), '');
  RETURN NEW;
END;
$$;
CREATE TRIGGER buses_before_write BEFORE INSERT OR UPDATE ON public.buses
FOR EACH ROW EXECUTE FUNCTION public.buses_before_write();

CREATE OR REPLACE FUNCTION public.buses_after_crew_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts text[] := '{}';
BEGIN
  IF NEW.driver_name IS DISTINCT FROM OLD.driver_name THEN
    v_parts := v_parts || ('Driver: ' || coalesce(NEW.driver_name, 'not assigned'));
  END IF;
  IF NEW.attendant_name IS DISTINCT FROM OLD.attendant_name THEN
    v_parts := v_parts || ('Attendant: ' || coalesce(NEW.attendant_name, 'not assigned'));
  END IF;
  IF array_length(v_parts, 1) > 0 THEN
    INSERT INTO public.transport_notices (org_id, branch_id, bus_id, kind, message)
    VALUES (NEW.org_id, NEW.branch_id, NEW.id, 'crew_change',
      'Driver/Attendant update for Bus ' || NEW.bus_number || ': ' || array_to_string(v_parts, ', '));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER buses_after_crew_change AFTER UPDATE OF driver_name, attendant_name ON public.buses
FOR EACH ROW EXECUTE FUNCTION public.buses_after_crew_change();

CREATE OR REPLACE FUNCTION public.is_bus_crew(_user_id uuid, _bus_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.buses WHERE id = _bus_id AND login_user_id = _user_id AND login_active)
$$;

CREATE OR REPLACE FUNCTION public.can_operate_trip(_user_id uuid, _trip_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bus_trips t
    WHERE t.id = _trip_id AND public.is_bus_crew(_user_id, t.bus_id)
  )
$$;

DROP POLICY IF EXISTS "Crew start bus trips" ON public.bus_trips;
CREATE POLICY "Crew start bus trips" ON public.bus_trips FOR INSERT TO authenticated
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.is_bus_crew(auth.uid(), bus_id));

-- Trips: location pause + one-off location requests
ALTER TABLE public.bus_trips ADD COLUMN IF NOT EXISTS location_paused boolean NOT NULL DEFAULT false;
ALTER TABLE public.bus_trips ADD COLUMN IF NOT EXISTS location_requested_at timestamptz;

CREATE OR REPLACE FUNCTION public.bus_trips_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus record;
BEGIN
  SELECT org_id, branch_id INTO v_bus FROM public.buses WHERE id = NEW.bus_id;
  IF v_bus.org_id IS NULL THEN RAISE EXCEPTION 'Bus not found'; END IF;
  NEW.org_id := v_bus.org_id;
  NEW.branch_id := v_bus.branch_id;
  IF TG_OP = 'INSERT' AND NOT public.org_transport_active(v_bus.org_id) THEN
    RAISE EXCEPTION 'Transport plan required';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.location_requested_at := NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.bus_id := OLD.bus_id;
    NEW.org_id := OLD.org_id;
    NEW.branch_id := OLD.branch_id;
    NEW.direction := OLD.direction;
    IF OLD.status = 'completed' THEN
      NEW.status := 'completed';
    END IF;
  END IF;
  IF NEW.status = 'in_transit' AND NEW.started_at IS NULL THEN NEW.started_at := now(); END IF;
  IF NEW.started_at IS NOT NULL AND NEW.started_at > now() THEN NEW.started_at := now(); END IF;
  IF NEW.status = 'completed' AND NEW.ended_at IS NULL THEN NEW.ended_at := now(); END IF;
  IF NEW.ended_at IS NOT NULL AND NEW.ended_at > now() THEN NEW.ended_at := now(); END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_bus_location(_trip_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') OR NOT public.mfa_ok() THEN
    RAISE EXCEPTION 'Only administrators can request a bus location';
  END IF;
  UPDATE public.bus_trips t SET location_requested_at = now()
  WHERE t.id = _trip_id AND t.status = 'in_transit'
    AND t.org_id = public.get_user_org_id(auth.uid())
    AND public.in_my_branch(t.branch_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.pupil_bus_logs_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip record;
  v_member record;
  v_guardian record;
BEGIN
  SELECT id, org_id, branch_id, bus_id, status INTO v_trip FROM public.bus_trips WHERE id = NEW.trip_id;
  IF v_trip.id IS NULL OR v_trip.status = 'scheduled' THEN RAISE EXCEPTION 'This ride has not started'; END IF;
  IF NOT public.org_transport_active(v_trip.org_id) THEN RAISE EXCEPTION 'Transport plan required'; END IF;
  SELECT id, org_id, bus_id INTO v_member FROM public.members WHERE id = NEW.member_id;
  IF v_member.id IS NULL OR v_member.org_id <> v_trip.org_id OR v_member.bus_id IS DISTINCT FROM v_trip.bus_id THEN
    RAISE EXCEPTION 'This pupil is not on this bus';
  END IF;
  NEW.org_id := v_trip.org_id;
  NEW.branch_id := v_trip.branch_id;
  IF NEW.guardian_id IS NOT NULL THEN
    SELECT id, member_id, name INTO v_guardian FROM public.guardians WHERE id = NEW.guardian_id;
    IF v_guardian.id IS NULL OR v_guardian.member_id <> NEW.member_id THEN
      RAISE EXCEPTION 'Guardian is not authorized for this pupil';
    END IF;
    NEW.guardian_name := v_guardian.name;
  ELSE
    NEW.guardian_name := NULL;
  END IF;
  IF NEW."timestamp" IS NULL OR NEW."timestamp" > now() THEN NEW."timestamp" := now(); END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bus_trip_points_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip record;
BEGIN
  SELECT org_id, branch_id INTO v_trip FROM public.bus_trips WHERE id = NEW.trip_id;
  IF v_trip.org_id IS NULL THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF NOT public.org_transport_active(v_trip.org_id) THEN RAISE EXCEPTION 'Transport plan required'; END IF;
  NEW.org_id := v_trip.org_id;
  NEW.branch_id := v_trip.branch_id;
  IF NEW.recorded_at IS NULL OR NEW.recorded_at > now() THEN NEW.recorded_at := now(); END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.transport_notices_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := coalesce(
      (SELECT m.branch_id FROM public.members m WHERE m.id = NEW.member_id),
      (SELECT b.branch_id FROM public.buses b WHERE b.id = NEW.bus_id),
      public.main_branch_id(NEW.org_id));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER transport_notices_before_insert BEFORE INSERT ON public.transport_notices
FOR EACH ROW EXECUTE FUNCTION public.transport_notices_before_insert();

-- Bus emergencies (school only, never parents)
CREATE TABLE public.bus_emergencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT,
  bus_id uuid NOT NULL REFERENCES public.buses(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES public.bus_trips(id) ON DELETE SET NULL,
  lat double precision,
  lng double precision,
  raised_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  emailed_at timestamptz,
  client_id text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text
);
CREATE INDEX bus_emergencies_org_open_idx ON public.bus_emergencies(org_id, created_at DESC) WHERE resolved_at IS NULL;
GRANT SELECT ON public.bus_emergencies TO authenticated;
GRANT INSERT (bus_id, trip_id, lat, lng, raised_by, client_id, org_id) ON public.bus_emergencies TO authenticated;
GRANT UPDATE (resolved_at) ON public.bus_emergencies TO authenticated;
GRANT ALL ON public.bus_emergencies TO service_role;
ALTER TABLE public.bus_emergencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org staff view bus emergencies" ON public.bus_emergencies FOR SELECT TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Bus login raises emergencies" ON public.bus_emergencies FOR INSERT TO authenticated
WITH CHECK (raised_by = auth.uid() AND public.is_bus_crew(auth.uid(), bus_id));
CREATE POLICY "Admins resolve emergencies" ON public.bus_emergencies FOR UPDATE TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.bus_emergencies_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT org_id, branch_id INTO v_bus FROM public.buses WHERE id = NEW.bus_id;
    IF v_bus.org_id IS NULL THEN RAISE EXCEPTION 'Bus not found'; END IF;
    NEW.org_id := v_bus.org_id;
    NEW.branch_id := v_bus.branch_id;
    NEW.created_at := now();
    NEW.resolved_at := NULL;
    NEW.resolved_by := NULL;
    NEW.emailed_at := NULL;
    IF NEW.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bus_trips t WHERE t.id = NEW.trip_id AND t.bus_id = NEW.bus_id) THEN
      NEW.trip_id := NULL;
    END IF;
  ELSE
    NEW.org_id := OLD.org_id;
    NEW.branch_id := OLD.branch_id;
    NEW.bus_id := OLD.bus_id;
    NEW.created_at := OLD.created_at;
    IF NEW.resolved_at IS NOT NULL AND OLD.resolved_at IS NULL THEN
      NEW.resolved_at := now();
      NEW.resolved_by := auth.uid();
    ELSE
      NEW.resolved_at := OLD.resolved_at;
      NEW.resolved_by := OLD.resolved_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bus_emergencies_before_write BEFORE INSERT OR UPDATE ON public.bus_emergencies
FOR EACH ROW EXECUTE FUNCTION public.bus_emergencies_before_write();

-- Guard self-onboarding requests (pending until an admin approves)
CREATE TABLE public.staff_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid
);
GRANT SELECT ON public.staff_requests TO authenticated;
GRANT ALL ON public.staff_requests TO service_role;
ALTER TABLE public.staff_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Applicants view their own request" ON public.staff_requests FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY "Admins view staff requests" ON public.staff_requests FOR SELECT TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin') AND public.staff_scope(branch_id));

-- Captcha-checked sign-up tickets (issued by the server after Turnstile)
CREATE TABLE public.signup_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
GRANT ALL ON public.signup_tickets TO service_role;
ALTER TABLE public.signup_tickets ENABLE ROW LEVEL SECURITY;

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
  v_plan text := coalesce(v_meta->>'plan', 'basic');
  v_trial boolean := coalesce(v_meta->>'trial', 'true') = 'true';
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
  RETURNING id INTO v_ticket;
  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'Sign-up check failed. Please complete the security check and try again.';
  END IF;
  v_type := (v_meta->>'org_type')::public.org_type;
  IF coalesce(trim(v_meta->>'org_name'), '') = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;
  IF v_type = 'school' AND public.is_free_email_domain(v_domain) THEN
    RAISE EXCEPTION 'Schools must sign up with an official school domain email';
  END IF;
  IF v_plan NOT IN ('basic', 'standard', 'group') THEN v_plan := 'basic'; END IF;
  IF v_plan <> 'basic' THEN v_trial := false; END IF;
  INSERT INTO public.organizations (name, type, admin_email, email_domain, emergency_phone, plan, trial_ends_at)
  VALUES (trim(v_meta->>'org_name'), v_type, NEW.email, v_domain, v_phone, v_plan,
    CASE WHEN v_trial THEN now() + interval '14 days' ELSE now() END)
  RETURNING id INTO v_org;
  INSERT INTO public.profiles (id, org_id, full_name, email)
  VALUES (NEW.id, v_org, coalesce(v_meta->>'full_name', ''), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  RETURN NEW;
END;
$$;

-- Registration link per branch
CREATE OR REPLACE FUNCTION public.get_registration_branch(_token text)
RETURNS TABLE (org_id uuid, org_name text, org_type public.org_type, emergency_phone text, branch_id uuid, branch_name text, branch_count integer, classes text[], transport boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.name, o.type, o.emergency_phone, b.id, b.name,
    (SELECT count(*)::int FROM public.branches x WHERE x.org_id = o.id),
    o.classes, public.org_transport_active(o.id)
  FROM public.branches b JOIN public.organizations o ON o.id = b.org_id
  WHERE b.registration_token = _token
$$;
REVOKE ALL ON FUNCTION public.get_registration_branch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_registration_branch(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_registration_org(text) IS 'DEPRECATED: use get_registration_branch.';
COMMENT ON FUNCTION public.get_registration_classes(text) IS 'DEPRECATED: use get_registration_branch.';
COMMENT ON FUNCTION public.get_registration_transport(text) IS 'DEPRECATED: use get_registration_branch.';

-- Edit a child's details: needs the school's 4-digit code
REVOKE UPDATE ON public.members FROM authenticated;
GRANT UPDATE (photo_path, bus_id, uses_bus) ON public.members TO authenticated;

CREATE OR REPLACE FUNCTION public.edit_member(
  _member_id uuid, _pin text, _full_name text, _class text, _parent_name text,
  _email text, _phone text, _branch_id uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.get_user_org_id(auth.uid());
  v_member record;
  v_secret record;
  v_classes text[];
  v_class text := nullif(btrim(coalesce(_class, '')), '');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') OR NOT public.mfa_ok() THEN
    RAISE EXCEPTION 'Only administrators can edit student details';
  END IF;
  SELECT id, org_id, branch_id INTO v_member FROM public.members WHERE id = _member_id;
  IF v_member.id IS NULL OR v_member.org_id <> v_org OR NOT public.in_my_branch(v_member.branch_id) THEN
    RAISE EXCEPTION 'Student not found';
  END IF;
  SELECT * INTO v_secret FROM public.org_secrets WHERE org_id = v_org FOR UPDATE;
  IF v_secret.locked_until IS NOT NULL AND v_secret.locked_until > now() THEN
    RETURN 'locked';
  END IF;
  IF v_secret.edit_pin IS DISTINCT FROM _pin THEN
    UPDATE public.org_secrets SET
      failed_attempts = CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
      locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
    WHERE org_id = v_org;
    RETURN 'wrong_code';
  END IF;
  UPDATE public.org_secrets SET failed_attempts = 0 WHERE org_id = v_org;

  IF char_length(btrim(coalesce(_full_name, ''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter the student''s name'; END IF;
  IF btrim(coalesce(_email, '')) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR char_length(_email) > 255 THEN RAISE EXCEPTION 'Enter a valid parent email'; END IF;
  IF char_length(coalesce(_parent_name, '')) > 120 OR char_length(coalesce(_phone, '')) > 30 THEN RAISE EXCEPTION 'Some details are too long'; END IF;
  SELECT classes INTO v_classes FROM public.organizations WHERE id = v_org;
  IF v_class IS NOT NULL AND coalesce(array_length(v_classes, 1), 0) > 0 THEN
    SELECT c INTO v_class FROM unnest(v_classes) c WHERE lower(c) = lower(v_class) LIMIT 1;
    IF v_class IS NULL THEN RAISE EXCEPTION 'Choose a class from your school''s list'; END IF;
  END IF;
  IF _branch_id IS NOT NULL AND _branch_id IS DISTINCT FROM v_member.branch_id THEN
    IF NOT public.is_hq_admin(auth.uid()) THEN RAISE EXCEPTION 'Only headquarters can move a student to another branch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = _branch_id AND b.org_id = v_org) THEN RAISE EXCEPTION 'Branch not found'; END IF;
  END IF;

  UPDATE public.members SET
    full_name = btrim(_full_name),
    identifier_code = v_class,
    parent_or_owner_name = nullif(btrim(coalesce(_parent_name, '')), ''),
    primary_email = lower(btrim(_email)),
    primary_phone = nullif(btrim(coalesce(_phone, '')), ''),
    branch_id = coalesce(_branch_id, branch_id)
  WHERE id = _member_id;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.edit_member(uuid, text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_member(uuid, text, text, text, text, text, text, uuid) TO authenticated;

-- Attendance respects branches
CREATE OR REPLACE FUNCTION public.attendance_marks(_from date, _to date)
RETURNS TABLE(member_id uuid, gate_days date[], bus_days date[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT public.get_user_org_id(auth.uid()) AS org_id
    WHERE (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'guard'))
      AND public.mfa_ok()
      AND _to >= _from
      AND _to - _from <= 400
  ),
  g AS (
    SELECT l.member_id, (l."timestamp" AT TIME ZONE 'Africa/Lagos')::date AS d
    FROM public.gate_logs l JOIN me ON l.org_id = me.org_id
    WHERE l."timestamp" >= (_from::timestamp AT TIME ZONE 'Africa/Lagos')
      AND l."timestamp" < ((_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
      AND public.in_my_branch(l.branch_id)
  ),
  b AS (
    SELECT l.member_id, (l."timestamp" AT TIME ZONE 'Africa/Lagos')::date AS d
    FROM public.pupil_bus_logs l JOIN me ON l.org_id = me.org_id
    WHERE l."timestamp" >= (_from::timestamp AT TIME ZONE 'Africa/Lagos')
      AND l."timestamp" < ((_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
      AND public.in_my_branch(l.branch_id)
  ),
  ids AS (SELECT g.member_id FROM g UNION SELECT b.member_id FROM b)
  SELECT
    ids.member_id,
    coalesce((SELECT array_agg(DISTINCT g.d ORDER BY g.d) FROM g WHERE g.member_id = ids.member_id), '{}'::date[]),
    coalesce((SELECT array_agg(DISTINCT b.d ORDER BY b.d) FROM b WHERE b.member_id = ids.member_id), '{}'::date[])
  FROM ids
  ORDER BY ids.member_id
$$;

-- Branch isolation + admin two-step sign-in, as restrictive policies
CREATE POLICY "Branch scope" ON public.members AS RESTRICTIVE FOR ALL TO authenticated
USING (public.staff_scope(branch_id)) WITH CHECK (public.staff_scope(branch_id));
CREATE POLICY "Branch scope" ON public.guardians AS RESTRICTIVE FOR ALL TO authenticated
USING (public.staff_scope(branch_id)) WITH CHECK (public.staff_scope(branch_id));
CREATE POLICY "Branch scope" ON public.gate_logs AS RESTRICTIVE FOR ALL TO authenticated
USING (public.staff_scope(branch_id)) WITH CHECK (public.staff_scope(branch_id));
CREATE POLICY "Branch scope" ON public.buses AS RESTRICTIVE FOR ALL TO authenticated
USING (public.staff_scope(branch_id)) WITH CHECK (public.staff_scope(branch_id));
CREATE POLICY "Branch scope" ON public.bus_crew AS RESTRICTIVE FOR ALL TO authenticated
USING (public.staff_scope(branch_id)) WITH CHECK (public.staff_scope(branch_id));
CREATE POLICY "Branch scope" ON public.bus_trips AS RESTRICTIVE FOR ALL TO authenticated
USING (public.staff_scope(branch_id)) WITH CHECK (public.staff_scope(branch_id));
CREATE POLICY "Branch scope" ON public.bus_trip_points AS RESTRICTIVE FOR ALL TO authenticated
USING (public.staff_scope(branch_id)) WITH CHECK (public.staff_scope(branch_id));
CREATE POLICY "Branch scope" ON public.pupil_bus_logs AS RESTRICTIVE FOR ALL TO authenticated
USING (public.staff_scope(branch_id)) WITH CHECK (public.staff_scope(branch_id));
CREATE POLICY "Branch scope" ON public.transport_notices AS RESTRICTIVE FOR ALL TO authenticated
USING (public.staff_scope(branch_id)) WITH CHECK (public.staff_scope(branch_id));
CREATE POLICY "Branch scope" ON public.bus_emergencies AS RESTRICTIVE FOR ALL TO authenticated
USING (public.staff_scope(branch_id)) WITH CHECK (public.staff_scope(branch_id));
CREATE POLICY "Branch scope" ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
USING (id = auth.uid() OR branch_id IS NULL OR public.in_my_branch(branch_id));
CREATE POLICY "HQ admins with two-step sign-in" ON public.organizations AS RESTRICTIVE FOR UPDATE TO authenticated
USING (public.is_hq_admin(auth.uid()) AND public.mfa_ok()) WITH CHECK (public.is_hq_admin(auth.uid()) AND public.mfa_ok());
CREATE POLICY "Two-step sign-in" ON public.payments AS RESTRICTIVE FOR SELECT TO authenticated
USING (public.mfa_ok());

-- Photos: a branch only reaches photos of its own students.
CREATE OR REPLACE FUNCTION public.photo_in_scope(_name text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_part text := split_part(_name, '/', 2);
  v_branch uuid;
BEGIN
  IF v_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN public.mfa_ok();
  END IF;
  SELECT branch_id INTO v_branch FROM public.members WHERE id = v_part::uuid;
  IF v_branch IS NULL THEN
    RETURN public.mfa_ok();
  END IF;
  RETURN public.staff_scope(v_branch);
END;
$$;
CREATE POLICY "Photos branch scope" ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (bucket_id <> 'photos' OR public.photo_in_scope(name))
WITH CHECK (bucket_id <> 'photos' OR public.photo_in_scope(name));

-- Function execute grants
REVOKE ALL ON FUNCTION public.org_effective_plan(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_max_buses(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_branch_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.in_my_branch(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mfa_ok() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_scope(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_hq_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.main_branch_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_bus_location(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_in_scope(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_effective_plan(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_max_buses(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_branch_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.in_my_branch(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mfa_ok() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_scope(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_hq_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.main_branch_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_bus_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_in_scope(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.branches_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organizations_after_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.org_secrets_before_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.members_branch_before_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.members_branch_after_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.buses_before_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.buses_after_crew_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transport_notices_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bus_emergencies_before_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guardians_before_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_org_admin() FROM PUBLIC, anon, authenticated;