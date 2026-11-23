-- Transport plan: separate paid-until date for the bus module.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS transport_paid_until timestamptz;
COMMENT ON COLUMN public.organizations.transport_paid_until IS 'Transport module paid until. Written only by server-side payment settlement.';

-- New plan ids: monthly (gate), transport (gate + bus, monthly), session (gate + bus, 12 months). yearly kept for old rows.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_plan_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_plan_check CHECK (plan IN ('monthly', 'yearly', 'transport', 'session'));

-- Admins may only edit profile-type columns; billing dates are server-only.
REVOKE UPDATE ON public.organizations FROM authenticated;
GRANT UPDATE (name, emergency_phone, classes, transport_enabled, registration_token) ON public.organizations TO authenticated;

-- Transport is usable while the package is ticked and the school is in its trial or has paid for transport.
CREATE OR REPLACE FUNCTION public.org_transport_active(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = _org_id
      AND o.transport_enabled
      AND (o.trial_ends_at > now() OR coalesce(o.transport_paid_until, '-infinity'::timestamptz) > now())
  )
$$;
REVOKE ALL ON FUNCTION public.org_transport_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_transport_active(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bus_trips_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.buses WHERE id = NEW.bus_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Bus not found'; END IF;
  NEW.org_id := v_org;
  IF TG_OP = 'INSERT' AND NOT public.org_transport_active(v_org) THEN
    RAISE EXCEPTION 'Transport plan required';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.bus_id := OLD.bus_id;
    NEW.org_id := OLD.org_id;
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
$function$;

CREATE OR REPLACE FUNCTION public.pupil_bus_logs_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_trip record;
  v_member record;
  v_guardian record;
BEGIN
  SELECT id, org_id, bus_id, status INTO v_trip FROM public.bus_trips WHERE id = NEW.trip_id;
  IF v_trip.id IS NULL OR v_trip.status = 'scheduled' THEN RAISE EXCEPTION 'This ride has not started'; END IF;
  IF NOT public.org_transport_active(v_trip.org_id) THEN RAISE EXCEPTION 'Transport plan required'; END IF;
  SELECT id, org_id, bus_id INTO v_member FROM public.members WHERE id = NEW.member_id;
  IF v_member.id IS NULL OR v_member.org_id <> v_trip.org_id OR v_member.bus_id IS DISTINCT FROM v_trip.bus_id THEN
    RAISE EXCEPTION 'This pupil is not on this bus';
  END IF;
  NEW.org_id := v_trip.org_id;
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
$function$;

CREATE OR REPLACE FUNCTION public.bus_trip_points_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.bus_trips WHERE id = NEW.trip_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF NOT public.org_transport_active(v_org) THEN RAISE EXCEPTION 'Transport plan required'; END IF;
  NEW.org_id := v_org;
  IF NEW.recorded_at IS NULL OR NEW.recorded_at > now() THEN NEW.recorded_at := now(); END IF;
  RETURN NEW;
END;
$function$;

-- Attendance: the school days each student was seen, at the gate or on a bus (school time zone).
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
      AND _to >= _from
      AND _to - _from <= 400
  ),
  g AS (
    SELECT l.member_id, (l."timestamp" AT TIME ZONE 'Africa/Lagos')::date AS d
    FROM public.gate_logs l JOIN me ON l.org_id = me.org_id
    WHERE l."timestamp" >= (_from::timestamp AT TIME ZONE 'Africa/Lagos')
      AND l."timestamp" < ((_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
  ),
  b AS (
    SELECT l.member_id, (l."timestamp" AT TIME ZONE 'Africa/Lagos')::date AS d
    FROM public.pupil_bus_logs l JOIN me ON l.org_id = me.org_id
    WHERE l."timestamp" >= (_from::timestamp AT TIME ZONE 'Africa/Lagos')
      AND l."timestamp" < ((_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
  ),
  ids AS (SELECT g.member_id FROM g UNION SELECT b.member_id FROM b)
  SELECT
    ids.member_id,
    coalesce((SELECT array_agg(DISTINCT g.d ORDER BY g.d) FROM g WHERE g.member_id = ids.member_id), '{}'::date[]),
    coalesce((SELECT array_agg(DISTINCT b.d ORDER BY b.d) FROM b WHERE b.member_id = ids.member_id), '{}'::date[])
  FROM ids
  ORDER BY ids.member_id
$$;
REVOKE ALL ON FUNCTION public.attendance_marks(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_marks(date, date) TO authenticated, service_role;
